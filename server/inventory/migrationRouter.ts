import { z } from "zod";
import { protectedProcedure as publicProcedure } from "../_core/trpc";
import { protectedProcedure, router } from "../_core/trpc";
import { parseCSVLine } from "./csvLine";
import {
  bulkUpsertLocalInventoriesFromCsv,
  countLocalInventories,
  countLocalPurchases,
  getAllInventoryExtras,
  isZaicoEnabled,
  setSystemSetting,
  upsertLocalInventory,
  upsertLocalPurchase,
} from "./db";
import { getInventories, getPurchases } from "./zaico";

export const migrationRouter = router({
    /**
     * Zaico連携の有効/無効状態を取得する
     */
    getZaicoEnabled: publicProcedure.query(async () => {
      return { enabled: await isZaicoEnabled() };
    }),
    /**
     * Zaico連携のON/OFFを切り替える
     */
    setZaicoEnabled: protectedProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await setSystemSetting("zaico_enabled", "false");
        return { success: true, enabled: false };
      }),
    /**
     * ZaicoデータをサイトDBにインポートする
     * 在庫データと発注データ（ordered/not_ordered）を全件取得してDBに保存する
     */
    importFromZaico: protectedProcedure.mutation(async () => {
      const results = { inventories: 0, purchases: 0, errors: [] as string[] };
      results.errors.push("Zaico API integration is disabled. Use CSV import or create records in this site.");
      return results;

      // 1. 在庫データをインポート
      try {
        const inventories = await getInventories(50); // 最大50ページ
        const extras = await getAllInventoryExtras();
        const extrasMap = new Map(extras.map((e) => [e.zaicoInventoryId, e]));

        for (const inv of inventories) {
          const extra = extrasMap.get(inv.id);
          await upsertLocalInventory({
            zaicoId: inv.id,
            title: inv.title,
            category: inv.category ?? null,
            place: inv.place ?? null,
            quantity: Math.round(parseFloat(inv.quantity) || 0),
            unit: inv.unit ?? "個",
            unitPrice: inv.unit_price != null ? String(inv.unit_price) : null,
            etc: inv.etc ?? null,
            supplierUrl: extra?.supplierUrl ?? null,
            supplierName: extra?.supplierName ?? null,
            isDeleted: 0,
          });
          results.inventories++;
        }
      } catch (err) {
        const msg = String(err);
        results.errors.push(`在庫インポートエラー: ${msg}`);
      }

      // 2. 発注データ（ordered/not_ordered）をインポート
      try {
        const purchases = await getPurchases();
        for (const p of purchases) {
          for (const item of p.purchase_items) {
            await upsertLocalPurchase({
              zaicoId: p.id * 10000 + item.id, // ユニークID: purchaseId*10000+itemId
              purchaseNum: p.num ?? null,
              status: item.status === "purchased" ? "purchased" : "ordered",
              itemsJson: JSON.stringify(p.purchase_items),
              localInventoryId: null,
              title: item.title,
              category: null,
              quantity: Math.round(parseFloat(item.quantity) || 1),
              unitPrice: item.unit_price != null ? String(item.unit_price) : null,
              managementNo: item.etc ?? null,
              purchaseDate: p.purchase_date ?? null,
              receivedDate: item.status === "purchased" ? (item.purchase_date ?? null) : null,
            });
            results.purchases++;
          }
        }
      } catch (err) {
        const msg = String(err);
        results.errors.push(`発注インポートエラー: ${msg}`);
      }

      return results;
    }),
    /**
     * インポート済みデータの件数を返す（進捗確認用）
     */
    getImportStats: publicProcedure.query(async () => {
      const [invCount, purCount] = await Promise.all([
        countLocalInventories(),
        countLocalPurchases(),
      ]);
      return { inventories: invCount, purchases: purCount };
    }),
    /**
     * Zaico CSVエクスポートデータをパースしてlocal_inventoriesに一括upsertする
     * フロントエンドからCSVテキストを送信する
     */
    importZaicoCsv: protectedProcedure
      .input(z.object({
        csvText: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        // CSVパース（Shift-JISはフロントエンド側でUTF-8に変換済みと想定）
        const lines = input.csvText.split(/\r?\n/);
        if (lines.length < 2) throw new Error("データがありません");

        // ヘッダー行の列名を取得
        const headerLine = lines[0];
        const headers = parseCSVLine(headerLine);
        const idxId = headers.indexOf("在庫ID");
        const idxTitle = headers.indexOf("物品名");
        const idxCategory = headers.indexOf("カテゴリ");
        const idxPlace = headers.indexOf("保管場所");
        const idxQty = headers.indexOf("数量");
        const idxUnit = headers.indexOf("単位");
        const idxNote = headers.indexOf("備考");
        const idxUnitPrice = headers.indexOf("仕入単価");

        if (idxId < 0 || idxTitle < 0) {
          throw new Error("必須列（在庫ID、物品名）が見つかりません。ヘッダー: " + headers.join(","));
        }

        const items: import("../../drizzle/schema").InsertLocalInventory[] = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const cols = parseCSVLine(line);
          const zaicoIdRaw = idxId >= 0 ? cols[idxId]?.trim() : "";
          const title = idxTitle >= 0 ? cols[idxTitle]?.trim() : "";
          if (!title) continue;

          const zaicoId = zaicoIdRaw ? parseInt(zaicoIdRaw, 10) : null;
          const category = idxCategory >= 0 ? cols[idxCategory]?.trim() || null : null;
          const place = idxPlace >= 0 ? cols[idxPlace]?.trim() || null : null;
          const qtyRaw = idxQty >= 0 ? cols[idxQty]?.trim() : "0";
          const quantity = Math.round(parseFloat(qtyRaw || "0") || 0);
          const unit = idxUnit >= 0 ? cols[idxUnit]?.trim() || "個" : "個";
          const note = idxNote >= 0 ? cols[idxNote]?.trim() || null : null;
          const unitPriceRaw = idxUnitPrice >= 0 ? cols[idxUnitPrice]?.trim() : "";
          const unitPrice = unitPriceRaw ? unitPriceRaw : null;

          // 備考フィールドから管理番号と仕入先を抽出
          // パターン: "管理番号, YYYY-MM-DD HH:MM:SS, 仕入先名"
          let supplierName: string | null = null;
          let etc: string | null = note;
          if (note) {
            const noteParts = note.split(",").map((p: string) => p.trim());
            if (noteParts.length >= 3) {
              // 3パーツ形式: 管理番号, 日付, 仕入先
              supplierName = noteParts[2] || null;
              etc = noteParts[0] || null; // 管理番号のみをetcに保存
            }
          }

          items.push({
            zaicoId: zaicoId && !isNaN(zaicoId) ? zaicoId : null,
            title,
            category,
            place,
            quantity,
            unit,
            unitPrice,
            etc,
            supplierUrl: null,
            supplierName,
            isDeleted: 0,
          });
        }

        if (items.length === 0) throw new Error("インポート対象のデータがありません");

        const result = await bulkUpsertLocalInventoriesFromCsv(items);
        return {
          total: items.length,
          inserted: result.inserted,
          updated: result.updated,
          errors: result.errors.slice(0, 10), // 最大2件のエラーのみ返却
        };
      }),
});
