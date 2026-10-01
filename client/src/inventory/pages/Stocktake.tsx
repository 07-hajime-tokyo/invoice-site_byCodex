import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StocktakeCamera } from "../components/StocktakeCamera";
import { stocktakeCode, summarizeStocktake } from "@shared/stocktake";

const money = (n: number) =>
  n.toLocaleString("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 2,
  });
const jstDate = (date: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date);
const time = (value: string | Date) =>
  new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
const panel = "rounded-xl border bg-background p-4 space-y-3";
function savedId() {
  try {
    return localStorage.getItem("stocktake-selected") || "";
  } catch {
    return "";
  }
}

export default function Stocktake() {
  const utils = trpc.useUtils();
  const [id, setId] = useState(savedId);
  const [basisDate, setBasisDate] = useState(() =>
    jstDate(new Date(Date.now() - 86400000))
  );
  const [stopped, setStopped] = useState(false);
  const [scan, setScan] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("missing");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(0);
  const [newSession, setNewSession] = useState(false);
  const scanInput = useRef<HTMLInputElement>(null);
  const queue = useRef<string[]>([]);
  const busy = useRef(false);
  const finalizing = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [finishChecked, setFinishChecked] = useState(false);
  const startId = useRef(crypto.randomUUID());
  const list = trpc.inventory.stocktake.list.useQuery();
  const detail = trpc.inventory.stocktake.get.useQuery(
    { id },
    { enabled: Boolean(id), refetchOnWindowFocus: true }
  );
  const start = trpc.inventory.stocktake.start.useMutation();
  const record = trpc.inventory.stocktake.record.useMutation();
  const session = detail.data;
  const summary = useMemo(
    () =>
      session ? summarizeStocktake(session.snapshot, session.state) : null,
    [session]
  );
  const open = session?.status === "open";
  function choose(value: string) {
    if (pending || busy.current || record.isPending) return;
    setId(value);
    setNewSession(false);
    setNotes("");
    setError("");
    setMessage("");
    try {
      localStorage.setItem("stocktake-selected", value);
    } catch {
      /* optional convenience only */
    }
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`stocktake-queue-${id}`) || "[]"
      );
      queue.current = Array.isArray(saved)
        ? saved.filter((code: unknown) => typeof code === "string")
        : [];
      setNotes(localStorage.getItem(`stocktake-notes-${id}`) || "");
    } catch {
      queue.current = [];
    }
    setPending(queue.current.length);
  }, [id]);
  useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending]);
  function saveQueue() {
    setPending(queue.current.length);
    try {
      localStorage.setItem(
        `stocktake-queue-${id}`,
        JSON.stringify(queue.current)
      );
    } catch {
      setError(
        "このブラウザでは未送信QRを端末に保存できません。保存完了までページを閉じないでください。"
      );
    }
  }
  async function drain() {
    if (busy.current || !id || !open) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const result = await record.mutateAsync({
          id,
          action: { type: "scan", code: queue.current[0] },
        });
        utils.inventory.stocktake.get.setData({ id }, result);
        queue.current.shift();
        saveQueue();
        setMessage(result.message);
        setError("");
      }
    } catch (e) {
      setError(
        `保存できませんでした。未送信QRは残っています。「再送」を押してください。${e instanceof Error ? e.message : ""}`
      );
    } finally {
      busy.current = false;
    }
  }
  function enqueue(raw: string) {
    if (!open || finalizing.current) return;
    try {
      const code = stocktakeCode(raw);
      if (!queue.current.includes(code)) {
        queue.current.push(code);
        saveQueue();
      }
      setScan("");
      void drain();
      scanInput.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "QRを確認してください");
    }
  }
  async function manual(inventoryId: number, quantity: number) {
    try {
      const result = await record.mutateAsync({
        id,
        action: { type: "manual", inventoryId, quantity },
      });
      utils.inventory.stocktake.get.setData({ id }, result);
      setMessage("数量を保存しました");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    }
  }
  async function finish() {
    if (!session || queue.current.length || busy.current || !finishChecked) return;
    finalizing.current = true;
    setFinishing(true);
    try {
      const result = await record.mutateAsync({
        id,
        action: { type: "finish", notes },
      });
      utils.inventory.stocktake.get.setData({ id }, result);
      void list.refetch();
      setError("");
      setMessage("棚卸記録を確定しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "確定できませんでした");
    } finally {
      finalizing.current = false;
      setFinishing(false);
    }
  }
  function download() {
    if (!session || !summary) return;
    const safe = (x: unknown) => {
      const s = String(x ?? "");
      return `"${(/^[=+@-]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"`;
    };
    const csv = [
      [
        "棚卸基準日",
        session.basisDate,
        "開始日時",
        time(session.snapshot.capturedAt),
        "状態",
        open ? "途中" : "確定",
      ],
      [
        "区分",
        "管理番号/QR",
        "商品",
        "登録数",
        "確認数",
        "仕入単価",
        "登録金額",
        "確認金額",
        "未確認QR/備考",
      ],
      ...summary.rows.map(r => [
        "在庫",
        r.managementNo,
        r.title,
        r.quantity,
        r.confirmed,
        r.unitPrice,
        r.quantity * r.unitPrice,
        r.confirmed * r.unitPrice,
        r.unscanned.join(" / "),
      ]),
      ...summary.exceptions.map(s => [
        "要確認",
        s.code,
        s.title,
        "",
        "",
        "",
        "",
        "",
        time(s.at),
      ]),
      ...summary.boxes.map(b => [
        "箱（別枠）",
        b.code,
        b.status,
        b.labels.length,
        b.confirmedContents,
        "",
        "",
        "",
        b.boxConfirmed ? "箱のみ確認済み" : "箱未確認",
      ]),
      ["メモ", session.state.notes || notes],
      ["スキャン履歴", "QR", "確認日時", "担当者"],
      ...session.state.scans.map(s => [
        "スキャン",
        s.code,
        time(s.at),
        s.operator,
      ]),
    ]
      .map(r => r.map(safe).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `実地棚卸_${session.basisDate}_${session.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-20">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">QR棚卸</h1>
          <p className="text-sm text-muted-foreground">
            現物を確認して、登録在庫との差分を残します。
          </p>
        </div>
        <Button
          variant="outline"
          disabled={pending > 0 || record.isPending}
          onClick={() => setNewSession(!newSession)}
        >
          新しい棚卸
        </Button>
      </header>
      {(error || detail.error || list.error) && (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-red-800"
        >
          {error || detail.error?.message || list.error?.message}
        </div>
      )}
      <div className={panel}>
        <label className="block text-sm font-medium" htmlFor="stocktake-list">
          保存済み・途中の棚卸
        </label>
        <select
          id="stocktake-list"
          className="w-full rounded border bg-background p-2"
          value={id}
          disabled={pending > 0 || record.isPending}
          onChange={e => choose(e.target.value)}
        >
          <option value="">選んで再開</option>
          {list.data?.map(s => (
            <option key={s.id} value={s.id}>
              {s.basisDate}末 ／ {s.status === "open" ? "作業中" : "確定"} ／{" "}
              {time(s.createdAt)}
            </option>
          ))}
        </select>
      </div>
      {(!id || newSession) && (
        <section className={panel}>
          <h2 className="font-semibold">1. 棚卸を開始</h2>
          <label className="block">
            棚卸基準日
            <Input
              type="date"
              value={basisDate}
              max={jstDate(new Date())}
              onChange={e => setBasisDate(e.target.value)}
              className="mt-1 max-w-xs"
            />
          </label>
          <p className="text-sm">
            実地確認日は今日。9月末を確認する場合は基準日を9月30日にしてください。過去の在庫を自動復元する機能ではありません。
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={stopped}
              onChange={e => setStopped(e.target.checked)}
            />
            <span>
              基準日末から入出庫がないことを確認し、棚卸完了まで荷受け・出庫・在庫移動を止めます。
            </span>
          </label>
          <Button
            disabled={!stopped || !basisDate || start.isPending || pending > 0}
            onClick={async () => {
              try {
                const result = await start.mutateAsync({
                  id: startId.current,
                  basisDate,
                  noMovementConfirmed: true,
                });
                choose(result.id);
                startId.current = crypto.randomUUID();
                utils.inventory.stocktake.get.setData(
                  { id: result.id },
                  result
                );
                await list.refetch();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "開始できませんでした"
                );
              }
            }}
          >
            開始時の在庫を固定して始める
          </Button>
        </section>
      )}
      {detail.isLoading && id && <p>棚卸記録を読み込んでいます…</p>}
      {session && summary && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              <strong>{session.basisDate}末の棚卸</strong> ／{" "}
              {open ? "作業中・スキャンごとに自動保存" : "確定済み"}
              <br />
              <span className="text-sm text-muted-foreground">
                実地確認開始 {time(session.snapshot.capturedAt)}
              </span>
            </p>
            <Button variant="outline" onClick={download}>
              CSV保存
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["登録在庫", `${summary.expected}点`],
              ["現物確認", `${summary.confirmed}点`],
              ["未確認", `${summary.missing}点`],
              ["要確認QR", `${summary.exceptions.length}件`],
            ].map(([label, value]) => (
              <div className={panel} key={label}>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-sm">
            登録在庫金額 {money(summary.expectedAmount)} ／ 現物確認金額{" "}
            {money(summary.confirmedAmount)}
            （開始時の仕入単価。箱の別枠・登録外QRは含みません）
            {summary.zeroPriceRows > 0 && (
              <strong className="text-amber-700">
                {" "}
                ／ 単価未設定・0円 {summary.zeroPriceRows}行
              </strong>
            )}
          </p>
          {open && (
            <section className={`${panel} border-emerald-400`}>
              <h2 className="font-semibold">2. 商品QRを順にスキャン</h2>
              <form
                className="flex gap-2"
                onSubmit={e => {
                  e.preventDefault();
                  enqueue(scan);
                }}
              >
                <Input
                  ref={scanInput}
                  autoFocus
                  autoComplete="off"
                  aria-label="商品QRまたは箱QR"
                  placeholder="QRリーダーで読取 → Enter"
                  value={scan}
                  onChange={e => setScan(e.target.value)}
                />
                <Button type="submit" disabled={!scan.trim() || finishing}>
                  確認
                </Button>
              </form>
              <StocktakeCamera onScan={enqueue} disabled={!open || finishing} />
              <p
                role="status"
                aria-live="polite"
                className="min-h-6 font-medium text-emerald-800"
              >
                {message}
              </p>
              <p className="text-sm">
                {pending
                  ? `未送信 ${pending}件 — 保存完了まで閉じないでください`
                  : "未送信なし"}{" "}
                {pending > 0 && (
                  <Button size="sm" variant="outline" onClick={drain}>
                    再送
                  </Button>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                同じQRは何度読んでも1点です。箱QRでは中身を確認済みにしません。
              </p>
            </section>
          )}
          <section className={panel}>
            <h2 className="font-semibold">3. 未確認・差異を確認</h2>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="表示対象"
                className="rounded border bg-background p-2"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              >
                <option value="missing">未確認・数量差異</option>
                <option value="all">すべて</option>
                <option value="confirmed">確認済みを含む商品</option>
                <option value="manual">QRなし・数量確認</option>
              </select>
              <Input
                placeholder="商品名・管理番号・商品QRで絞り込み"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="max-w-md"
              />
            </div>
            <div className="space-y-3">
              {summary.rows
                .filter(
                  r =>
                    (filter === "all" ||
                      (filter === "missing" &&
                        (r.missing > 0 || r.excess > 0 || r.labelConflict)) ||
                      (filter === "confirmed" && r.confirmed > 0) ||
                      (filter === "manual" && r.manualCapacity > 0)) &&
                    `${r.title} ${r.managementNo} ${r.labelIds.join(" ")}`
                      .toLowerCase()
                      .includes(search.toLowerCase())
                )
                .map(r => (
                  <article key={r.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{r.title}</h3>
                        <p className="text-xs text-muted-foreground">
                          {r.category} ／ {r.managementNo || "管理番号なし"}
                        </p>
                      </div>
                      <strong
                        className={
                          r.missing || r.excess
                            ? "text-amber-700"
                            : "text-emerald-700"
                        }
                      >
                        確認 {r.confirmed} / 登録 {r.quantity}点
                      </strong>
                    </div>
                    {r.labelConflict && (
                      <p className="text-sm text-red-700">
                        在庫数より個体QRの登録が多いため要確認
                      </p>
                    )}
                    {r.unscanned.length > 0 && (
                      <p className="mt-2 break-all font-mono text-sm">
                        未確認QR：{r.unscanned.join(" / ")}
                      </p>
                    )}
                    <p className="mt-1 text-xs">
                      {r.labelIds
                        .map(code => {
                          const label = session.snapshot.labels.find(
                            l => l.code === code
                          );
                          return `${code}: ${label?.invoiceNo ? `充当先 No.${label.invoiceNo}` : "充当先未定"}`;
                        })
                        .join(" ／ ")}
                    </p>
                    {r.manualCapacity > 0 && (
                      <ManualCount
                        key={`${session.id}-${r.id}`}
                        value={r.manualCount}
                        max={r.manualCapacity}
                        disabled={!open || record.isPending || pending > 0}
                        onSave={quantity => manual(r.id, quantity)}
                      />
                    )}
                  </article>
                ))}
            </div>
          </section>
          {summary.exceptions.length > 0 && (
            <section className={`${panel} border-amber-400`}>
              <h2 className="font-semibold">登録在庫と一致しないQR</h2>
              {summary.exceptions.map(s => (
                <p key={s.code}>
                  <strong>{s.code}</strong> {s.title} ／ {time(s.at)}
                </p>
              ))}
              <p className="text-sm">
                確認金額には足していません。差異の理由を記録してください。
              </p>
            </section>
          )}
          <section className={panel}>
            <h2 className="font-semibold">梱包中・封済みの箱（別枠）</h2>
            <p className="text-sm">
              箱の存在と中身の個体確認を区別します。封済み商品の金額は上の在庫金額に加算していません。
            </p>
            {summary.boxes.length === 0 ? (
              <p className="text-sm">対象の箱なし</p>
            ) : (
              summary.boxes.map(b => (
                <div key={b.code} className="rounded border p-2">
                  <strong>{b.code}</strong>{" "}
                  {b.status === "sealed" ? "封済み・未発送登録" : "梱包中"} ／
                  箱 {b.boxConfirmed ? "確認済み" : "未確認"} ／ 中身のQR{" "}
                  {b.confirmedContents}/{b.labels.length}点
                </div>
              ))
            )}
            <p className="text-sm text-muted-foreground">
              購入済み未着は現物棚卸の対象外です。発注登録で別途照合してください。発送登録済みでも手元に残っている箱は、QRを読むと要確認に残ります。
            </p>
          </section>
          <section className={panel}>
            <h2 className="font-semibold">4. 棚卸記録を確定</h2>
            <p className="text-sm">
              未確認・差異がある場合は理由を記録します。確定しても在庫数・入出庫記録は変更しません。
            </p>
            {open ? (
              <>
                <textarea
                  aria-label="差異・未確認の理由"
                  placeholder="未確認の理由、別保管、封済み箱の扱いなど"
                  className="min-h-24 w-full rounded border bg-background p-3"
                  value={notes}
                  maxLength={10000}
                  onChange={e => {
                    setNotes(e.target.value);
                    try {
                      localStorage.setItem(
                        `stocktake-notes-${id}`,
                        e.target.value
                      );
                    } catch {}
                  }}
                />
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={finishChecked} onChange={e => setFinishChecked(e.target.checked)} />差異を確認しました。確定後はこの記録へのスキャン追加ができなくなることを了承します。</label>
                <Button
                  disabled={pending > 0 || record.isPending || !finishChecked}
                  onClick={finish}
                >
                  棚卸記録を確定する
                </Button>
              </>
            ) : (
              <p className="whitespace-pre-wrap">
                {session.state.notes || "メモなし"}
                <br />
                確定日時：{session.completedAt ? time(session.completedAt) : ""}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function ManualCount({
  value,
  max,
  disabled,
  onSave,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onSave: (n: number) => void;
}) {
  const [count, setCount] = useState(String(value));
  useEffect(() => setCount(String(value)), [value]);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span>QRなし {max}点の現物確認：</span>
      <Input
        aria-label="QRなし商品の確認数"
        type="number"
        min={0}
        max={max}
        value={count}
        onChange={e => setCount(e.target.value)}
        className="w-24"
        disabled={disabled}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={
          disabled ||
          count === "" ||
          !Number.isInteger(Number(count)) ||
          Number(count) < 0 ||
          Number(count) > max
        }
        onClick={() => onSave(Number(count))}
      >
        数量を保存
      </Button>
    </div>
  );
}
