import type { InvoicePreviewProps } from "./types";

export function InvoicePreview({
  form,
  clientData,
  senderSettings,
}: InvoicePreviewProps) {
  const accent = form.accentColor || "#db8b1a";
  const currencySymbol = form.currency === "USD" ? "$" : form.currency === "EUR" ? "€" : form.currency === "GBP" ? "£" : form.currency === "JPY" ? "¥" : form.currency;
  const fmt = (n: number) => {
    if (form.currency === "JPY") return n.toLocaleString();
    return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };
  const contactLineStyle = { margin: "2px 0", lineHeight: 1.55, overflowWrap: "anywhere", wordBreak: "break-word" } as const;
  const formatContactLine = (line: string) => line.replace(/([:：])(?=\S)/g, "$1 ");

  const subtotal = form.items.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
  const taxTotal = form.items.reduce((s, item) => {
    const rate = (item.tax ?? 0) / 100;
    return s + item.quantity * item.unitPrice * rate;
  }, 0);
  const total = subtotal + taxTotal;

  return (
    <div
      className="invoice-preview"
      style={{
        fontFamily: "'Lato', 'Helvetica Neue', Arial, sans-serif",
        minHeight: "297mm",
        fontSize: "13px",
        lineHeight: "1.6",
        overflow: "hidden",
        // Explicit colors to avoid oklch() which html2canvas cannot parse
        backgroundColor: "#ffffff",
        color: "#111827",
      }}
    >
      {/* ── Top color bar ── */}
      <div style={{ height: "8px", background: `linear-gradient(90deg, ${accent} 0%, ${accent}99 100%)` }} />

      <div style={{ padding: "40px 56px 48px" }}>
      {/* ── Header: Logo + Company | Invoice title ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "40px" }}>
        {/* Left: logo + company */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          {senderSettings?.logoUrl ? (
            <img
              src={senderSettings.logoUrl}
              alt="Logo"
              style={{ width: "72px", height: "72px", objectFit: "contain", borderRadius: "8px", flexShrink: 0 }}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {senderSettings?.senderCompany && (
              <p style={{ fontSize: "20px", fontWeight: 700, color: "#111", margin: 0, lineHeight: 1.2 }}>{senderSettings.senderCompany}</p>
            )}
            {senderSettings?.senderName && !senderSettings?.senderCompany && (
              <p style={{ fontSize: "20px", fontWeight: 700, color: "#111", margin: 0, lineHeight: 1.2 }}>{senderSettings.senderName}</p>
            )}
          </div>
        </div>
        {/* Right: Invoice number + dates */}
        <div style={{ textAlign: "right" }}>
          <h1 style={{ fontSize: "44px", fontWeight: 800, color: accent, margin: "0 0 6px 0", letterSpacing: "-1.5px" }}>
            Invoice: {form.invoiceNumber.replace(/^INV-\d{8}-/, "") || form.invoiceNumber}
          </h1>
          {form.invoiceDate && (
            <p style={{ fontSize: "12px", color: "#666", margin: "2px 0" }}>Issued on: {form.invoiceDate}</p>
          )}
          {form.dueDate && (
            <p style={{ fontSize: "12px", color: "#666", margin: "2px 0" }}>Due by: {form.dueDate}</p>
          )}
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ height: "2px", background: `linear-gradient(90deg, ${accent} 0%, #e5e7eb 100%)`, marginBottom: "32px" }} />

      {/* ── From / To ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px", marginBottom: "40px" }}>
        {/* From */}
        <div>
          <p style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: accent, marginBottom: "10px", borderBottom: `2px solid ${accent}`, paddingBottom: "4px", display: "inline-block" }}>From</p>
          {senderSettings?.senderCompany && <p style={{ margin: "2px 0" }}>{senderSettings.senderCompany}</p>}
          {senderSettings?.senderName && <p style={{ margin: "2px 0" }}>{senderSettings.senderName}</p>}
          {senderSettings?.senderAddress && <p style={{ margin: "2px 0" }}>{senderSettings.senderAddress}</p>}
          {(senderSettings?.senderCity || senderSettings?.senderCountry) && (
            <p style={{ margin: "2px 0" }}>
              {[senderSettings?.senderCity, senderSettings?.senderCountry].filter(Boolean).join(" ")}
            </p>
          )}
          {senderSettings?.senderEmail && <p style={{ margin: "2px 0" }}>{senderSettings.senderEmail}</p>}
          {senderSettings?.senderPhone && <p style={{ margin: "2px 0" }}>{senderSettings.senderPhone}</p>}
          {senderSettings?.senderExtraInfo && senderSettings.senderExtraInfo.split("\n").map((line, i) => (
            <p key={i} style={{ margin: "2px 0" }}>{line}</p>
          ))}
          {!senderSettings?.senderName && !senderSettings?.senderCompany && (
            <p style={{ color: "#aaa", fontStyle: "italic" }}>差出人未設定</p>
          )}
        </div>
        {/* To */}
        <div>
          <p style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", color: accent, marginBottom: "10px", borderBottom: `2px solid ${accent}`, paddingBottom: "4px", display: "inline-block" }}>To</p>
          {clientData ? (
            <>
              {clientData.company && <p style={contactLineStyle}>{formatContactLine(clientData.company)}</p>}
              {clientData.name && <p style={contactLineStyle}>{formatContactLine(clientData.name)}</p>}
              {clientData.address && <p style={contactLineStyle}>{formatContactLine(clientData.address)}</p>}
              {(clientData.city || clientData.country) && (
                <p style={contactLineStyle}>
                  {formatContactLine([clientData.city, clientData.country].filter(Boolean).join(" "))}
                </p>
              )}
              {clientData.email && <p style={contactLineStyle}>{formatContactLine(clientData.email)}</p>}
              {clientData.phone && <p style={contactLineStyle}>{formatContactLine(clientData.phone)}</p>}
              {clientData.notes && <p style={contactLineStyle}>{formatContactLine(clientData.notes)}</p>}
              {clientData.extraInfo && clientData.extraInfo.split("\n").map((line, i) => (
                <p key={i} style={contactLineStyle}>{formatContactLine(line)}</p>
              ))}
            </>
          ) : (
            <p style={{ color: "#aaa", fontStyle: "italic" }}>宛先未選択</p>
          )}
        </div>
      </div>

      {/* ── Items table ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "32px" }}>
        <thead>
          <tr style={{ backgroundColor: "#f0f0f0" }}>
            <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333" }}>Product</th>
            <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333", width: "80px" }}>Quantity</th>
            {form.showAmounts && (
              <>
                <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333", width: "110px" }}>Unit Price</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333", width: "80px" }}>Tax</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600, fontSize: "13px", color: "#333", width: "110px" }}>Total</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {form.items.length === 0 ? (
            <tr>
              <td colSpan={form.showAmounts ? 5 : 2} style={{ padding: "24px", textAlign: "center", color: "#aaa", fontStyle: "italic" }}>
                明細がありません
              </td>
            </tr>
          ) : (
            form.items.map((item, i) => {
              const lineTotal = item.quantity * item.unitPrice;
              const taxRate = item.tax ?? 0;
              return (
                <tr key={i} style={{ borderBottom: "1px solid #e5e5e5" }}>
                  <td style={{ padding: "14px 12px" }}>
                    <p style={{ fontWeight: 700, margin: 0 }}>{item.description}</p>
                    {item.subText && (
                      <p style={{ margin: 0, fontSize: "11px", color: "#888", marginTop: "2px" }}>{item.subText}</p>
                    )}
                  </td>
                  <td style={{ padding: "14px 12px", textAlign: "center" }}>{item.quantity}</td>
                  {form.showAmounts && (
                    <>
                      <td style={{ padding: "14px 12px", textAlign: "right" }}>{currencySymbol} {fmt(item.unitPrice)}</td>
                      <td style={{ padding: "14px 12px", textAlign: "right" }}>{taxRate > 0 ? `${taxRate}%` : "—"}</td>
                      <td style={{ padding: "14px 12px", textAlign: "right", fontWeight: 600 }}>{currencySymbol} {fmt(lineTotal)}</td>
                    </>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* ── Invoice Summary (right-aligned) ── */}
      {form.showAmounts && form.items.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "32px" }}>
          <div style={{ minWidth: "240px" }}>
            {/* Summary header */}
            <div style={{
              backgroundColor: "#f0f0f0",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              borderRadius: "4px 4px 0 0",
            }}>
              {/* Bar chart icon */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="12" width="4" height="9" rx="1" fill="#555"/>
                <rect x="10" y="7" width="4" height="14" rx="1" fill="#555"/>
                <rect x="17" y="3" width="4" height="18" rx="1" fill="#555"/>
              </svg>
              <span style={{ fontWeight: 700, fontSize: "14px", color: "#222" }}>Invoice Summary</span>
            </div>
            {/* Summary rows */}
            <div style={{ border: "1px solid #e5e5e5", borderTop: "none", borderRadius: "0 0 4px 4px", overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ color: "#555" }}>Subtotal</span>
                <span>{currencySymbol} {fmt(subtotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ color: "#555" }}>Tax</span>
                <span>{currencySymbol} {fmt(taxTotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", fontWeight: 700 }}>
                <span>Total</span>
                <span>{currencySymbol} {fmt(total)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {form.notes && (
        <div style={{ borderTop: "1px solid #e5e5e5", paddingTop: "20px", marginBottom: "20px" }}>
          <p style={{ fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: "6px" }}>備考</p>
          <p style={{ color: "#555", whiteSpace: "pre-wrap", margin: 0 }}>{form.notes}</p>
        </div>
      )}

      {/* Page number footer removed */}
      </div>{/* end inner padding div */}
    </div>
  );
}

