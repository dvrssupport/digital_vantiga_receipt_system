
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../../components/ui/Button";
import Select from "../../../components/ui/Select";
import Icon from "../../../components/AppIcon";
import { supabase } from "../../../supabaseClient";
import { formatCurrencyINR } from "../../../utils/amount";
import { getRemittanceStatusBadge } from "../../../utils/remittanceStatus.jsx";
import {
  isSessionExpiredError,
  redirectToLogin,
  requireSupabaseUser
} from "../../../utils/auth";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All Status" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" }
];

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

const downloadCsv = (headers, rows, filename) => {
  const toCsvValue = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [headers, ...rows]
    .map((row) => row.map(toCsvValue).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const openPrintWindow = (title, bodyHtml) => {
  const printWindow = window.open("", "_blank", "width=1200,height=900");
  if (!printWindow) return;

  const escapeHtml = (value) => {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
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

const OfficeRemittancesTab = ({ selectedFY, canManageRemittances = true }) => {
  const navigate = useNavigate();
  const ledgerRef = useRef(null);

  const [remittances, setRemittances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [sabhaOptions, setSabhaOptions] = useState([{ value: "ALL", label: "All Sabhas" }]);
  const [selectedSabhaId, setSelectedSabhaId] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");

  const [collectedBySabha, setCollectedBySabha] = useState({});
  const [activeView, setActiveView] = useState("ledger");
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmVerifyId, setConfirmVerifyId] = useState(null);
  const [rejectTargetId, setRejectTargetId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadSabhas = async () => {
      const { data, error } = await supabase
        .from("sabhas")
        .select("id, name")
        .order("name");

      if (!isMounted) return;

      if (error) {
        console.warn("Failed to load sabhas", error);
        return;
      }

      const options = (data || []).map((row) => ({
        value: row.id,
        label: row.name
      }));
      setSabhaOptions([{ value: "ALL", label: "All Sabhas" }, ...options]);
    };

    loadSabhas();

    return () => {
      isMounted = false;
    };
  }, []);
  const fetchRemittances = useCallback(async () => {
    if (!selectedFY) return;

    setLoading(true);
    setLoadError(null);

    try {
      let query = supabase
        .from("sabha_remittances")
        .select(`
          id, sabha_id, fy, remitted_amount, remitted_at, remittance_mode,
          reference_no, status, verified_at, rejection_reason,
          sabhas:sabha_id ( id, name, code )
        `)
        .eq("fy", selectedFY)
        .order("remitted_at", { ascending: false });

      if (selectedSabhaId !== "ALL") {
        query = query.eq("sabha_id", selectedSabhaId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setRemittances(data || []);
    } catch (err) {
      console.error("Failed to load remittances", err);
      setLoadError(err?.message || "Failed to load remittances");
      setRemittances([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFY, selectedSabhaId]);

  const fetchCollectedTotals = useCallback(async () => {
    if (!selectedFY) return;

    try {
      let query = supabase
        .from("vantiga_entries")
        .select(`
          sabha_id,
          status,
          families (
            family_members ( amount )
          )
        `)
        .eq("fy", selectedFY)
        .eq("status", "ACKNOWLEDGED");

      if (selectedSabhaId !== "ALL") {
        query = query.eq("sabha_id", selectedSabhaId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const totals = {};
      (data || []).forEach((entry) => {
        const sabhaId = entry?.sabha_id;
        if (!sabhaId) return;
        const members = entry?.families?.family_members || [];
        const entryTotal = members.reduce((sum, m) => sum + Number(m?.amount || 0), 0);
        totals[sabhaId] = (totals[sabhaId] || 0) + entryTotal;
      });

      setCollectedBySabha(totals);
    } catch (err) {
      console.warn("Failed to load collected totals", err);
      setCollectedBySabha({});
    }
  }, [selectedFY, selectedSabhaId]);

  useEffect(() => {
    fetchRemittances();
  }, [fetchRemittances]);

  useEffect(() => {
    fetchCollectedTotals();
  }, [fetchCollectedTotals]);

  useEffect(() => {
    if (!selectedFY) return;

    const channel = supabase.channel(`sabha_remittances_${selectedFY}`);
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sabha_remittances"
        },
        (payload) => {
          const newRow = payload?.new;
          const oldRow = payload?.old;
          const matchesFY =
            (newRow && newRow.fy === selectedFY) ||
            (oldRow && oldRow.fy === selectedFY);
          if (!matchesFY) return;

          if (selectedSabhaId !== "ALL") {
            const sabhaId = newRow?.sabha_id || oldRow?.sabha_id;
            if (sabhaId !== selectedSabhaId) return;
          }

          fetchRemittances();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedFY, selectedSabhaId, fetchRemittances]);

  const ledgerRows = useMemo(() => {
    if (selectedStatus === "ALL") return remittances;
    return (remittances || []).filter((row) => row?.status === selectedStatus);
  }, [remittances, selectedStatus]);

  const sabhaListForRollup = useMemo(() => {
    if (selectedSabhaId === "ALL") {
      return sabhaOptions.filter((opt) => opt.value !== "ALL");
    }
    const match = sabhaOptions.find((opt) => opt.value === selectedSabhaId);
    return match ? [match] : [];
  }, [sabhaOptions, selectedSabhaId]);

  const rollupRows = useMemo(() => {
    const totalsBySabha = {};
    (remittances || []).forEach((row) => {
      const sabhaId = row?.sabha_id;
      if (!sabhaId) return;
      if (!totalsBySabha[sabhaId]) {
        totalsBySabha[sabhaId] = {
          verified: 0,
          pending: 0,
          pendingCount: 0,
          totalCount: 0
        };
      }
      const bucket = totalsBySabha[sabhaId];
      bucket.totalCount += 1;
      if (row?.status === "VERIFIED") {
        bucket.verified += Number(row?.remitted_amount || 0);
      }
      if (row?.status === "SUBMITTED") {
        bucket.pending += Number(row?.remitted_amount || 0);
        bucket.pendingCount += 1;
      }
    });

    return sabhaListForRollup
      .map((sabha) => {
        const sabhaId = sabha.value;
        const rollup = totalsBySabha[sabhaId] || { verified: 0, pending: 0, pendingCount: 0, totalCount: 0 };
        const collected = collectedBySabha?.[sabhaId] || 0;
        const retained = collected - rollup.verified;
        return {
          sabhaId,
          sabhaName: sabha.label,
          collected,
          verified: rollup.verified,
          pending: rollup.pending,
          pendingCount: rollup.pendingCount,
          retained,
          totalCount: rollup.totalCount
        };
      })
      .sort((a, b) => b.retained - a.retained);
  }, [remittances, sabhaListForRollup, collectedBySabha]);

  const kpis = useMemo(() => {
    const totalCollected = rollupRows.reduce((sum, row) => sum + row.collected, 0);
    const totalVerified = rollupRows.reduce((sum, row) => sum + row.verified, 0);
    const pendingTotal = rollupRows.reduce((sum, row) => sum + row.pending, 0);
    const pendingCount = rollupRows.reduce((sum, row) => sum + row.pendingCount, 0);
    const retainedTotal = totalCollected - totalVerified;

    return {
      totalCollected,
      totalVerified,
      pendingTotal,
      pendingCount,
      retainedTotal
    };
  }, [rollupRows]);

  const closeVerifyModal = () => {
    setConfirmVerifyId(null);
  };

  const closeRejectModal = () => {
    setRejectTargetId(null);
    setRejectReason("");
  };

  const handleVerify = async () => {
    if (!canManageRemittances) return;
    if (!confirmVerifyId) return;

    setIsProcessing(true);
    try {
      const user = await requireSupabaseUser(supabase);
      const userId = user.id;

      const { error } = await supabase
        .from("sabha_remittances")
        .update({
          status: "VERIFIED",
          verified_at: new Date().toISOString(),
          verified_by: userId,
          rejection_reason: null
        })
        .eq("id", confirmVerifyId);

      if (error) throw error;
      await fetchRemittances();
      closeVerifyModal();
    } catch (err) {
      console.error("Failed to verify remittance", err);
      if (isSessionExpiredError(err)) {
        alert(err?.message || "Your session has expired. Please sign in again.");
        redirectToLogin(navigate);
        return;
      }
      alert(err?.message || "Failed to verify remittance");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!canManageRemittances) return;
    if (!rejectTargetId || !rejectReason.trim()) return;

    setIsProcessing(true);
    try {
      const user = await requireSupabaseUser(supabase);
      const userId = user.id;

      const { error } = await supabase
        .from("sabha_remittances")
        .update({
          status: "REJECTED",
          rejection_reason: rejectReason.trim(),
          verified_at: new Date().toISOString(),
          verified_by: userId
        })
        .eq("id", rejectTargetId);

      if (error) throw error;
      await fetchRemittances();
      closeRejectModal();
    } catch (err) {
      console.error("Failed to reject remittance", err);
      if (isSessionExpiredError(err)) {
        alert(err?.message || "Your session has expired. Please sign in again.");
        redirectToLogin(navigate);
        return;
      }
      alert(err?.message || "Failed to reject remittance");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      "Sabha",
      "Remitted Date",
      "Amount",
      "Mode",
      "Ref No",
      "Status",
      "Verified On",
      "Rejection Reason"
    ];

    const rows = ledgerRows.map((row) => [
      row?.sabhas?.name || "",
      formatDate(row?.remitted_at),
      Number(row?.remitted_amount || 0),
      row?.remittance_mode || "",
      row?.reference_no || "",
      row?.status || "",
      row?.verified_at ? formatDate(row?.verified_at) : "",
      row?.rejection_reason || ""
    ]);

    downloadCsv(headers, rows, `sabha-remittances-ledger-${selectedFY}.csv`);
  };

  const handleExportPdf = () => {
    const rowsHtml = ledgerRows.map((row) => `
      <tr>
        <td>${row?.sabhas?.name || ""}</td>
        <td>${formatDate(row?.remitted_at)}</td>
        <td class="right">${formatAmount(row?.remitted_amount)}</td>
        <td>${row?.remittance_mode || ""}</td>
        <td>${row?.reference_no || ""}</td>
        <td>${row?.status || ""}</td>
        <td>${row?.verified_at ? formatDate(row?.verified_at) : ""}</td>
        <td>${row?.rejection_reason || ""}</td>
      </tr>
    `).join("");

    const bodyHtml = `
      <h1>Remittances Ledger - FY ${selectedFY}</h1>
      <p>Rows exported: ${ledgerRows.length}</p>
      <table>
        <thead>
          <tr>
            <th>Sabha</th>
            <th>Remitted Date</th>
            <th class="right">Amount</th>
            <th>Mode</th>
            <th>Ref No</th>
            <th>Status</th>
            <th>Verified On</th>
            <th>Rejection Reason</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="8">No data</td></tr>'}
        </tbody>
      </table>
    `;

    openPrintWindow(`Remittances Ledger - FY ${selectedFY}`, bodyHtml);
  };

  const handleRollupClick = (sabhaId) => {
    setSelectedSabhaId(sabhaId);
    setActiveView("ledger");
    setTimeout(() => {
      ledgerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Icon name="IndianRupee" size={22} color="#3b82f6" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Total Collection across all Sabhas (Ack)</h3>
          <p className="text-2xl font-bold text-card-foreground">{formatAmount(kpis.totalCollected)}</p>
        </div>

        <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Icon name="CheckCircle2" size={22} color="#22c55e" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Total Remittance (Verified by SCM Office)</h3>
          <p className="text-2xl font-bold text-card-foreground">{formatAmount(kpis.totalVerified)}</p>
        </div>

        <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Icon name="Clock" size={22} color="#f59e0b" />
            </div>
          </div>
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Pending Remittances Request</h3>
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
          <h3 className="text-sm font-medium text-muted-foreground mb-1">Total Vantiga Retained (All Sabhas)</h3>
          <p className="text-2xl font-bold text-card-foreground">{formatAmount(kpis.retainedTotal)}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <Select
            label="Sabha"
            value={selectedSabhaId}
            onChange={(value) => setSelectedSabhaId(value)}
            options={sabhaOptions}
          />
          <Select
            label="Status"
            value={selectedStatus}
            onChange={(value) => setSelectedStatus(value)}
            options={STATUS_OPTIONS}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 bg-muted p-1 rounded-md">
        <button
          onClick={() => setActiveView("ledger")}
          className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
            activeView === "ledger"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Ledger
        </button>
        <button
          onClick={() => setActiveView("rollup")}
          className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
            activeView === "rollup"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Sabha Rollup
        </button>
      </div>

      {activeView === "ledger" && (
        <>
          <div className="bg-card border border-border rounded-lg shadow-sm" ref={ledgerRef}>
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">All Remittances Ledger</h3>
                <p className="text-xs text-muted-foreground">FY {selectedFY}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleExportCsv} iconName="Download">
                  Export CSV
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportPdf} iconName="FileText">
                  Export PDF
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              {loading && (
                <div className="px-6 py-4 text-sm text-muted-foreground">Loading remittances...</div>
              )}
              {loadError && (
                <div className="px-6 py-4 text-sm text-red-600">
                  Failed to load remittances: {String(loadError)}
                </div>
              )}
              {!loading && ledgerRows?.length > 0 ? (
                <table className="w-full">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                        Sabha
                      </th>
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
                        Ref No
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                        Verified On
                      </th>
                  <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                    Rejection Reason
                  </th>
                  {canManageRemittances && (
                    <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {ledgerRows.map((row) => (
                  <tr key={row?.id} className="hover:bg-muted/30 transition-colors duration-150">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                          {row?.sabhas?.name || "-"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                          {formatDate(row?.remitted_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-foreground">
                          {formatAmount(row?.remitted_amount)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                          {row?.remittance_mode || "-"}
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
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {row?.status === "REJECTED" ? row?.rejection_reason || "-" : "-"}
                    </td>
                    {canManageRemittances && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {row?.status === "SUBMITTED" ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmVerifyId(row?.id)}
                              disabled={isProcessing}
                            >
                              Verify
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setRejectTargetId(row?.id);
                                setRejectReason("");
                              }}
                              disabled={isProcessing}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
                </table>
              ) : !loading ? (
                <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No remittances found for the selected filters.
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}

      {activeView === "rollup" && (
        <div className="bg-card border border-border rounded-lg shadow-sm">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-lg font-semibold text-foreground">Sabha-wise Rollup</h3>
            <p className="text-xs text-muted-foreground">Retained = Collected - Verified</p>
          </div>
          <div className="overflow-x-auto">
            {rollupRows.length > 0 ? (
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                      Sabha
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                      Total Collected (Ack)
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                      Verified Remitted
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                      Pending Remittances
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                      Retained
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                      Remittance Count
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-border">
                  {rollupRows.map((row) => (
                    <tr key={row.sabhaId} className="hover:bg-muted/30 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        <button
                          type="button"
                          onClick={() => handleRollupClick(row.sabhaId)}
                          className="text-primary hover:underline"
                        >
                          {row.sabhaName}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-foreground">
                        {formatAmount(row.collected)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-foreground">
                        {formatAmount(row.verified)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-foreground">
                        {formatAmount(row.pending)}
                        <div className="text-xs text-muted-foreground">
                          {row.pendingCount} pending
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-foreground">
                        {formatAmount(row.retained)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-foreground">
                        {row.totalCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                No sabha rollup data for the selected filters.
              </div>
            )}
          </div>
        </div>
      )}

      {canManageRemittances && confirmVerifyId && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-[60] transition-opacity duration-300"
            onClick={closeVerifyModal}
          />
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center px-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="verify-remittance-title"
          >
            <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <h3 id="verify-remittance-title" className="text-lg font-semibold text-foreground">
                    Verify Remittance
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Confirm verification for this remittance.
                  </p>
                </div>
                <button
                  onClick={closeVerifyModal}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                  aria-label="Close verify modal"
                >
                  <Icon name="X" size={18} />
                </button>
              </div>
              <div className="px-5 py-4 text-sm text-muted-foreground">
                This action will mark the remittance as verified.
              </div>
              <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
                <Button variant="outline" onClick={closeVerifyModal} disabled={isProcessing}>
                  Cancel
                </Button>
                <Button variant="default" onClick={handleVerify} loading={isProcessing} disabled={isProcessing}>
                  Verify
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {canManageRemittances && rejectTargetId && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-[60] transition-opacity duration-300"
            onClick={closeRejectModal}
          />
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center px-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-remittance-title"
          >
            <div className="w-full max-w-lg bg-card border border-border rounded-lg shadow-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <h3 id="reject-remittance-title" className="text-lg font-semibold text-foreground">
                    Reject Remittance
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Provide a clear reason to reject this remittance.
                  </p>
                </div>
                <button
                  onClick={closeRejectModal}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                  aria-label="Close reject modal"
                >
                  <Icon name="X" size={18} />
                </button>
              </div>

              <div className="px-5 py-4 space-y-3">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Rejection Reason
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={4}
                  placeholder="Provide a reason"
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
              </div>

              <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
                <Button variant="outline" onClick={closeRejectModal} disabled={isProcessing}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleReject}
                  loading={isProcessing}
                  disabled={isProcessing || !rejectReason.trim()}
                >
                  Reject
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default OfficeRemittancesTab;
