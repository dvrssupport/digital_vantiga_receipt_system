import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useImperativeHandle,
  forwardRef
} from "react";
import { useNavigate } from "react-router-dom";
import toast, { Toaster } from "react-hot-toast";
import Input from "../../../components/ui/Input";
import Select from "../../../components/ui/Select";
import Button from "../../../components/ui/Button";
import Icon from "../../../components/AppIcon";
import { supabase } from "../../../supabaseClient";
import { formatCurrencyINR, formatAmountInWordsINR } from "../../../utils/amount";
import { getRemittanceStatusBadge } from "../../../utils/remittanceStatus.jsx";
import {
  isSessionExpiredError,
  redirectToLogin,
  requireSupabaseUser
} from "../../../utils/auth";

const REMITTANCE_MODES = [
  { value: "CHEQUE", label: "Cheque" },
  { value: "NEFT/RTGS/IMPS", label: "NEFT/RTGS/IMPS" },
  { value: "UPI", label: "UPI" },
];
const AMOUNT_PATTERN = /^\d*\.?\d{0,2}$/;

const getTodayInputValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDate = (dateString) => {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
};

const formatAmount = formatCurrencyINR;

const escapeHtml = (value) => {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const downloadCsv = (headers, rows, filename) => {
  const toCsvValue = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [headers, ...rows]
    .map((row) => row.map(toCsvValue).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

  if (window.navigator?.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
};

const openPrintWindow = (title, bodyHtml) => {
  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) return;

  printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      h1 { font-size: 18px; margin: 0 0 6px; }
      p { margin: 0 0 12px; color: #475569; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; text-transform: uppercase; letter-spacing: 0.02em; }
      .right { text-align: right; }
    </style>
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
    printWindow.onafterprint = () => printWindow.close();
  };
};

const RemittancesTab = forwardRef(({ selectedFY, userProfile }, ref) => {
  const navigate = useNavigate();
  const sabhaId = userProfile?.sabhaId;
  const [remittances, setRemittances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [totalCollectedAck, setTotalCollectedAck] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touchedFields, setTouchedFields] = useState({});

  const [formData, setFormData] = useState({
    remittedAt: getTodayInputValue(),
    remittedAmount: "",
    remittanceMode: "",
    referenceNo: "",
    bankName: "",
    remarks: ""
  });

  const validateField = (field, value, nextFormData = formData) => {
    const normalizedValue = typeof value === "string" ? value.trim() : value;

    if (field === "remittedAt" && !normalizedValue) {
      return "Date is required";
    }

    if (field === "remittedAmount") {
      const rawValue = String(value ?? "").trim();
      if (!rawValue) return "Amount is required";
      if (!AMOUNT_PATTERN.test(rawValue)) return "Enter a valid amount";
      const amountValue = Number(rawValue);
      if (!amountValue || amountValue <= 0) return "Amount must be greater than 0";
    }

    if (field === "remittanceMode" && !normalizedValue) {
      return "Mode is required";
    }

    if (field === "referenceNo" && !String(nextFormData?.referenceNo ?? "").trim()) {
      return "Reference no is required";
    }

    if (field === "bankName" && !String(nextFormData?.bankName ?? "").trim()) {
      return "Bank name is required";
    }

    return "";
  };

  const fetchRemittances = useCallback(async () => {
    if (!sabhaId || !selectedFY) return;
    setLoading(true);
    setLoadError(null);

    try {
      const { data, error } = await supabase
        .from("sabha_remittances")
        .select(`
          id, sabha_id, fy, remitted_amount, remitted_at, remittance_mode,
          reference_no, bank_name, status, verified_at, rejection_reason
        `)
        .eq("sabha_id", sabhaId)
        .eq("fy", selectedFY)
        .order("remitted_at", { ascending: false });

      if (error) throw error;
      setRemittances(data || []);
    } catch (err) {
      console.error("Failed to load remittances", err);
      setLoadError(err?.message || "Failed to load remittances");
      setRemittances([]);
    } finally {
      setLoading(false);
    }
  }, [sabhaId, selectedFY]);

  const fetchCollectedTotal = useCallback(async () => {
    if (!sabhaId || !selectedFY) return;

    try {
      const { data, error } = await supabase
        .from("vantiga_entries")
        .select(`
          sabha_id,
          status,
          families (
            family_members ( amount )
          )
        `)
        .eq("sabha_id", sabhaId)
        .eq("fy", selectedFY)
        .eq("status", "ACKNOWLEDGED");

      if (error) throw error;

      const total = (data || []).reduce((sum, entry) => {
        const members = entry?.families?.family_members || [];
        const entryTotal = members.reduce((mSum, m) => mSum + Number(m?.amount || 0), 0);
        return sum + entryTotal;
      }, 0);

      setTotalCollectedAck(total);
    } catch (err) {
      console.warn("Failed to load collected total", err);
      setTotalCollectedAck(0);
    }
  }, [sabhaId, selectedFY]);

  useEffect(() => {
    fetchRemittances();
  }, [fetchRemittances]);

  useEffect(() => {
    fetchCollectedTotal();
  }, [fetchCollectedTotal]);

  useEffect(() => {
    if (!sabhaId || !selectedFY) return;

    const channel = supabase.channel(`sabha_remittances_${sabhaId}`);
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sabha_remittances",
          filter: `sabha_id=eq.${sabhaId}`
        },
        (payload) => {
          const newRow = payload?.new;
          const oldRow = payload?.old;
          const matchesFY =
            (newRow && newRow.fy === selectedFY) ||
            (oldRow && oldRow.fy === selectedFY);
          if (matchesFY) fetchRemittances();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sabhaId, selectedFY, fetchRemittances]);

  const kpis = useMemo(() => {
    const verifiedTotal = remittances
      .filter((row) => row?.status === "VERIFIED")
      .reduce((sum, row) => sum + Number(row?.remitted_amount || 0), 0);

    const pendingRows = remittances.filter((row) => row?.status === "SUBMITTED");
    const pendingTotal = pendingRows.reduce((sum, row) => sum + Number(row?.remitted_amount || 0), 0);

    return {
      verifiedTotal,
      pendingTotal,
      pendingCount: pendingRows.length,
      retained: totalCollectedAck - verifiedTotal
    };
  }, [remittances, totalCollectedAck]);

  const remittedAmountNumber = Number(formData?.remittedAmount || 0);
  const remittedAmountInWords = remittedAmountNumber > 0
    ? formatAmountInWordsINR(remittedAmountNumber)
    : "";

  const handleFieldChange = (field, value) => {
    if (field === "remittedAmount") {
      const nextAmount = String(value ?? "");
      if (!AMOUNT_PATTERN.test(nextAmount)) {
        return;
      }
    }

    const nextFormData = { ...formData, [field]: value };
    setFormData(nextFormData);
    setTouchedFields((prev) => ({ ...prev, [field]: true }));
    setFieldErrors((prev) => ({ ...prev, [field]: validateField(field, value, nextFormData) }));
  };

  const handleFieldBlur = (field) => {
    setTouchedFields((prev) => ({ ...prev, [field]: true }));
    setFieldErrors((prev) => ({ ...prev, [field]: validateField(field, formData?.[field], formData) }));
  };

  const validateForm = () => {
    const requiredFields = ["remittedAt", "remittedAmount", "remittanceMode", "referenceNo", "bankName"];
    const nextErrors = {};

    requiredFields.forEach((field) => {
      const error = validateField(field, formData?.[field], formData);
      if (error) nextErrors[field] = error;
    });

    setFieldErrors(nextErrors);
    setTouchedFields((prev) => ({
      ...prev,
      remittedAt: true,
      remittedAmount: true,
      remittanceMode: true,
      referenceNo: true,
      bankName: true
    }));
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event?.preventDefault();
    if (!validateForm()) {
      toast.error("Please fill all required fields.");
      return;
    }
    if (!sabhaId) {
      toast.error("Sabha mapping missing. Please re-login.");
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await requireSupabaseUser(supabase);
      const userId = user.id;

      const referenceValue = formData.referenceNo?.trim();
      const bankValue = formData.bankName?.trim();
      const payload = {
        sabha_id: sabhaId,
        fy: selectedFY,
        remitted_at: formData.remittedAt,
        remitted_amount: Number(formData?.remittedAmount || 0),
        remittance_mode: formData.remittanceMode,
        reference_no: referenceValue,
        bank_name: bankValue,
        remarks: formData.remarks?.trim() || null,
        status: "SUBMITTED",
        created_by: userId
      };

      const { error } = await supabase.from("sabha_remittances").insert(payload);
      if (error) throw error;

      setFormData({
        remittedAt: getTodayInputValue(),
        remittedAmount: "",
        remittanceMode: "",
        referenceNo: "",
        bankName: "",
        remarks: ""
      });
      setFieldErrors({});
      setTouchedFields({});
      await fetchRemittances();
      toast.success("Remittance submitted for verification");
    } catch (err) {
      console.error("Failed to submit remittance", err);
      if (isSessionExpiredError(err)) {
        toast.error(err?.message || "Your session has expired. Please sign in again.");
        redirectToLogin(navigate);
        return;
      }
      toast.error(err?.message || "Failed to submit remittance");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = ["Date", "Amount", "Mode", "Bank Name", "Ref No", "Status", "Verified On"];
    const rows = (remittances || []).map((row) => [
      formatDate(row?.remitted_at),
      Number(row?.remitted_amount || 0),
      row?.remittance_mode || "",
      row?.bank_name || row?.bankName || "",
      row?.reference_no || "",
      row?.status || "",
      row?.verified_at ? formatDate(row?.verified_at) : ""
    ]);

    downloadCsv(headers, rows, `sabha-remittances-ledger-${selectedFY}.csv`);
  };

  const handleExportPdf = () => {
    const rowsHtml = (remittances || [])
      .map((row) => `
        <tr>
          <td>${escapeHtml(formatDate(row?.remitted_at))}</td>
          <td class="right">${escapeHtml(formatAmount(row?.remitted_amount))}</td>
          <td>${escapeHtml(row?.remittance_mode || "")}</td>
          <td>${escapeHtml(row?.bank_name || row?.bankName || "")}</td>
          <td>${escapeHtml(row?.reference_no || "")}</td>
          <td>${escapeHtml(row?.status || "")}</td>
          <td>${escapeHtml(row?.verified_at ? formatDate(row?.verified_at) : "")}</td>
        </tr>
      `)
      .join("");

    const bodyHtml = `
      <h1>Remittances Ledger - FY ${escapeHtml(selectedFY)}</h1>
      <p>Rows exported: ${(remittances || []).length}</p>
      <table>
        <thead>
          <tr>
            <th>Remitted Date</th>
            <th class="right">Amount</th>
            <th>Mode</th>
            <th>Bank Name</th>
            <th>Ref No</th>
            <th>Status</th>
            <th>Verified On</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="7">No data</td></tr>'}
        </tbody>
      </table>
    `;

    openPrintWindow(`Remittances Ledger - FY ${selectedFY}`, bodyHtml);
  };

  useImperativeHandle(ref, () => ({
    exportRemittancesCsv: handleExportCsv,
    exportRemittancesPdf: handleExportPdf
  }));

  if (!sabhaId) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-sm text-muted-foreground">
          Sabha mapping is missing. Please re-login or contact support.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Toaster position="top-right" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Icon name="IndianRupee" size={22} color="#3b82f6" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Total Collected (Acknowledged)</h3>
          <p className="text-2xl font-bold text-card-foreground">{formatAmount(totalCollectedAck)}</p>
        </div>

        <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Icon name="CheckCircle2" size={22} color="#22c55e" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Total Remitted (Verified)</h3>
          <p className="text-2xl font-bold text-card-foreground">{formatAmount(kpis.verifiedTotal)}</p>
        </div>

        <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Icon name="Clock" size={22} color="#f59e0b" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Pending Verification</h3>
          <p className="text-2xl font-bold text-card-foreground">{formatAmount(kpis.pendingTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {kpis.pendingCount} {kpis.pendingCount === 1 ? "remittance" : "remittances"}
          </p>
        </div>

        <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-slate-500/10 rounded-lg">
              <Icon name="Wallet" size={22} color="#64748b" />
            </div>
          </div>
          <h3
            className="text-sm font-medium text-muted-foreground mb-1"
            title="Retained = Acknowledged collection - Verified remittances"
          >
            Retained with Sabha
          </h3>
          <p className="text-2xl font-bold text-card-foreground">{formatAmount(kpis.retained)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Retained = Acknowledged collection - Verified remittances
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Submit Remittance</h3>
            <p className="text-xs text-muted-foreground">Submit for FY {selectedFY}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              type="date"
              label="Remitted Date"
              value={formData.remittedAt}
              onChange={(e) => handleFieldChange("remittedAt", e?.target?.value)}
              onBlur={() => handleFieldBlur("remittedAt")}
              error={touchedFields?.remittedAt ? fieldErrors.remittedAt : ""}
              required
              disabled={isSubmitting}
            />
            <div>
              <Input
                type="number"
                label="Amount"
                placeholder="Enter amount"
                value={formData.remittedAmount}
                onChange={(e) => handleFieldChange("remittedAmount", e?.target?.value)}
                onBlur={() => handleFieldBlur("remittedAmount")}
                step="0.01"
                min="0"
                hideNumberSpinners
                disableWheelNumberChange
                error={touchedFields?.remittedAmount ? fieldErrors.remittedAmount : ""}
                required
                disabled={isSubmitting}
              />
              {remittedAmountInWords && (
                <p className="mt-2 text-xs text-muted-foreground">
                  In words: {remittedAmountInWords}
                </p>
              )}
            </div>
            <Select
              label="Mode"
              value={formData.remittanceMode}
              onChange={(value) => handleFieldChange("remittanceMode", value)}
              options={REMITTANCE_MODES}
              error={touchedFields?.remittanceMode ? fieldErrors.remittanceMode : ""}
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Reference No"
              placeholder="Enter reference no"
              value={formData.referenceNo}
              onChange={(e) => handleFieldChange("referenceNo", e?.target?.value)}
              onBlur={() => handleFieldBlur("referenceNo")}
              error={touchedFields?.referenceNo ? fieldErrors.referenceNo : ""}
              required
              disabled={isSubmitting}
            />
            <Input
              label="Bank Name"
              placeholder="Enter bank name"
              value={formData.bankName}
              onChange={(e) => handleFieldChange("bankName", e?.target?.value)}
              onBlur={() => handleFieldBlur("bankName")}
              error={touchedFields?.bankName ? fieldErrors.bankName : ""}
              required
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Remarks</label>
            <textarea
              value={formData.remarks}
              onChange={(e) => handleFieldChange("remarks", e?.target?.value)}
              rows={3}
              placeholder="Optional remarks"
              className="mt-2 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              disabled={isSubmitting}
            />
          </div>

          <div className="flex items-center justify-end">
            <Button
              type="submit"
              variant="outline"
              loading={isSubmitting}
              disabled={isSubmitting}
              className="bg-[#F97316] text-white"
            >
              Submit Remittance
            </Button>
          </div>
        </form>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Remittance Ledger</h3>
            <p className="text-xs text-muted-foreground">FY {selectedFY}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading && (
            <div className="px-6 py-4 text-sm text-muted-foreground">
              Loading remittances...
            </div>
          )}

          {loadError && (
            <div className="px-6 py-4 text-sm text-red-600">
              Failed to load remittances: {String(loadError)}
            </div>
          )}

          {!loading && remittances?.length > 0 ? (
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                    Mode
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                    Bank Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                    Ref No
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                    Verified On
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {remittances.map((row) => (
                  <React.Fragment key={row?.id}>
                    <tr className="hover:bg-muted/30 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {formatDate(row?.remitted_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-foreground">
                        {formatAmount(row?.remitted_amount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {row?.remittance_mode || "-"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {row?.bank_name || row?.bankName || "-"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        {row?.reference_no || "-"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {getRemittanceStatusBadge(row?.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {row?.verified_at ? formatDate(row?.verified_at) : "-"}
                      </td>
                    </tr>
                    {row?.status === "REJECTED" && (
                      <tr className="bg-red-50/40">
                        <td colSpan={7} className="px-6 py-3 text-sm text-red-700">
                          Rejection reason: {row?.rejection_reason || "No reason provided"}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          ) : !loading ? (
            <div className="px-6 py-12 text-center">
              <Icon name="FileX" size={48} className="mx-auto text-muted-foreground mb-3" />
              <h3 className="text-lg font-medium text-foreground mb-1">No remittances found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                No remittances recorded for FY {selectedFY}.
              </p>
            </div>
          ) : null}
        </div>
      </div>

    </div>
  );
});

export default RemittancesTab;
