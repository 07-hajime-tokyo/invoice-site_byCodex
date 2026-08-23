/**
 * インボイスNoの読み取りを1か所にまとめる。
 *
 * これまで「インボイスNo」を5か所が別々の正規表現で文字列から推測していた。
 * 3桁固定のもの、3〜4桁のもの、`No.`接頭辞を拾うもの、桁数を見ないもの、
 * 失敗したら出庫No自体を返すもの。No.が4桁に入った時点で一部が無言で壊れる。
 *
 * ここに集約したうえで、集計は「出庫Noの文字列」ではなく
 * 「明細1点ずつの管理番号」から引く（resolveDeliveryItemInvoiceNo）。
 * そうしないと、1箱に403と408が混ざった出庫（箱ID B000002）がどちらにも計上されない。
 */

/** 個体の管理番号（例: `405_マキシム_PSP1000ブラック_2/6`）からインボイスNoを読む。 */
export function invoiceNoFromManagementNo(value: string | null | undefined): string | null {
  return String(value ?? "").normalize("NFKC").trim().match(/^(\d{3,5})(?:_|$)/)?.[1] ?? null;
}

/**
 * 出庫No（例: `405_Maxim260807`、`No.403_...`）からインボイスNoを読む。
 * 箱ID（`B000002`）のように数字で始まらないものは null を返す。
 */
export function invoiceNoFromDeliveryNo(value: string | null | undefined): string | null {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return null;
  const direct = text.match(/^(?:No\.?\s*)?(\d{1,5})(?=$|[_\s,/-])/i);
  if (direct) return direct[1];
  const embedded = text.match(/(?:^|[^\d])(?:No\.?\s*)?(\d{1,5})(?=_)/i);
  return embedded?.[1] ?? null;
}

/** 表示・グルーピング用。読めないときは出庫Noそのものを見せる。 */
export function invoiceGroupKeyFromDeliveryNo(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return invoiceNoFromDeliveryNo(text) ?? text;
}

export type DeliveryItemInvoiceSource = {
  managementNo?: string | null;
};

/**
 * 出庫明細1点のインボイスNoを決める。
 *
 * 1) 出庫Noの接頭辞。人が「この出庫は400宛」と宣言しているので最優先。
 * 2) 明細に保存された管理番号（出庫時に在庫の etc から取っている）
 * 3) 在庫IDから引き直した管理番号
 *
 * 管理番号を出庫Noより優先してはいけない。管理番号は「仕入れたときの引当先」であって
 * 「実際に出した先」ではないため。実データでも出庫No `400_Maxim260811` の中に
 * 管理番号 `388_サミー_ブラック_5/5` の在庫を充てた明細があり、これは400宛に数えるのが正しい。
 *
 * 3つとも読めなければ null。箱ID（`B000002`）の出庫で、かつ在庫から充当したぶん
 * （`在庫0814_1` など）がこれに当たる。どのインボイスの受注行に付くかは
 * 機械的に決まらないので、推測せず人に返す。
 */
export function resolveDeliveryItemInvoiceNo(
  item: DeliveryItemInvoiceSource,
  deliveryNo: string | null | undefined,
  fallbackManagementNo?: string | null
): string | null {
  return (
    invoiceNoFromDeliveryNo(deliveryNo) ??
    invoiceNoFromManagementNo(item.managementNo) ??
    invoiceNoFromManagementNo(fallbackManagementNo)
  );
}
