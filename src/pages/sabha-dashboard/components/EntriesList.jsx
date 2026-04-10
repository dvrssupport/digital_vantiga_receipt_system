import React, { useState, useMemo, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import Icon from "../../../components/AppIcon";
import Input from "../../../components/ui/Input";
import Select from "../../../components/ui/Select";
import Button from "../../../components/ui/Button";
import { useNavigate } from "react-router-dom";

import { fetchEntriesForSabhaFY } from "../../../db/entries";
import { supabase } from "../../../supabaseClient";
import { formatReceiptNumber } from "../../../utils/receiptNumber";
import { formatCurrencyINR } from "../../../utils/amount";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All Status" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "ACKNOWLEDGED", label: "Acknowledged" },
  { value: "REJECTED", label: "Rejected" },
];

const getDisplayGotra = (member) => {
  if (member?.gotra === "Others") {
    return member?.otherGotra || "Others";
  }
  return member?.gotra || "";
};

const REJECTION_REASONS = [
  "Amount not reflected in the bank account.",
  "Cheque bounced.",
  "Incorrect entry.",
];

const getStatusColor = (status) => {
  switch (status) {
    case "SUBMITTED":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "ACKNOWLEDGED":
      return "bg-green-100 text-green-700 border-green-200";
    case "REJECTED":
      return "bg-red-100 text-red-700 border-red-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
};

const EntriesList = forwardRef(({
  selectedFY,
  sabhaId,
  receiptCode,
  userRole,
  currentUserId,
  onEntriesUpdate,
  pratinidhiFilter = "ALL",
  pratinidhiOptions = [],
  onPratinidhiFilterChange,
}, ref) => {
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Entries loaded from Supabase
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesError, setEntriesError] = useState(null);

  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [selectedRejectReason, setSelectedRejectReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [auditTrail, setAuditTrail] = useState([]);
  const [loadingAuditTrail, setLoadingAuditTrail] = useState(false);

  const effectiveUserId = useMemo(() => {
    if (currentUserId) return currentUserId;
    try {
      const p = JSON.parse(localStorage.getItem("userProfile") || "{}");
      return p?.user_id || p?.userId || null;
    } catch {
      return null;
    }
  }, [currentUserId]);

  // Fallback receiptCode from localStorage profile if not provided
  const effectiveReceiptCode = useMemo(() => {
    if (receiptCode) return receiptCode;
    try {
      const p = JSON.parse(localStorage.getItem("userProfile") || "{}");
      return p?.receiptCode || p?.sabhaCode || "SABHA";
    } catch {
      return "SABHA";
    }
  }, [receiptCode]);

  const pratinidhiNameById = useMemo(() => {
    return new Map(
      (pratinidhiOptions || [])
        .filter((opt) => opt?.value && opt.value !== "ALL")
        .map((opt) => [opt.value, opt.label])
    );
  }, [pratinidhiOptions]);

  const resolvePratinidhiName = useCallback((entry) => {
    const direct =
      entry?.pratinidhi_name ||
      entry?.pratinidhi ||
      entry?.collected_by ||
      entry?.representative_name;
    if (direct) return direct;
    const submittedBy = entry?.submittedBy || entry?.submitted_by;
    if (submittedBy && pratinidhiNameById.has(submittedBy)) {
      return pratinidhiNameById.get(submittedBy);
    }
    return submittedBy || "-";
  }, [pratinidhiNameById]);

  // Notify parent of entries changes
  useEffect(() => {
    if (onEntriesUpdate) onEntriesUpdate(entries);
  }, [entries, onEntriesUpdate]);

  const mapRowsToUI = useCallback((rows) => {
    return (rows || []).map((r) => {
      const fam = r.families;
      const members = fam?.family_members || [];

      return {
        entryId: r.id,
        sabhaId: r.sabha_id, // ✅ keep sabhaId for logic
        fy: r.fy,
        entryType: r.entry_type || "Vantiga",
        submittedDate: r.submitted_at,
        submittedBy: r.submitted_by,
        status: r.status,
        paidBy: r.paid_by,
        referenceNo: r.reference_no || "",
        remarks: r.remarks || "",
        receiptNo: r.receipt_no || "",
        receiptBaseNo: r.receipt_base_no || "",
        editCount: Number(r.edit_count || 0),
        acknowledgedDate: r.acknowledged_at || "",
        rejectionReason: r.rejection_reason || null,

        family: {
          familyId: fam?.id,
          addressMultiLine: fam?.address_multiline || "",
          payerMobile: fam?.payer_mobile || "",
          payerEmail: fam?.payer_email || "",
          optShowAmountInDirectory: fam?.opt_show_amount_in_directory ? "Yes" : "No",
          optShowMobileInDirectory: fam?.opt_show_mobile_in_directory ? "Yes" : "No",
          optShowEmailInDirectory: fam?.opt_show_email_in_directory ? "Yes" : "No",
        },

        members: members.map((m) => ({
          memberId: m.id,
          name: m.full_name,
          age: m.age,
          gender: m.gender,
          gotra: m.gotra,
          otherGotra: m.other_gotra,
          isMarried: !!m.is_married,
          maidenSurname: m.maiden_surname || "",
          amount: Number(m.amount || 0),
          isPrimaryPayer: !!m.is_primary_payer,
        })),
      };
    });
  }, []);

  const loadEntries = useCallback(async () => {
    if (!sabhaId || !selectedFY) return;

    setLoadingEntries(true);
    setEntriesError(null);

    try {
      const submittedBy = userRole === "pratinidhi" ? effectiveUserId : null;
      const rows = await fetchEntriesForSabhaFY({ sabhaId, fy: selectedFY, submittedBy });
      const mapped = mapRowsToUI(rows);
      setEntries(mapped);
    } catch (e) {
      console.error("Failed to load entries", e);
      setEntriesError(e?.message || String(e));
      setEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  }, [sabhaId, selectedFY, mapRowsToUI, userRole, effectiveUserId]);

  // Load whenever sabhaId/FY changes
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // ✅ Realtime subscription: refresh on INSERT/UPDATE/DELETE for this sabha
  useEffect(() => {
    if (!sabhaId) return;

    const channel = supabase.channel(`vantiga_entries_${sabhaId}`);
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vantiga_entries",
          filter: `sabha_id=eq.${sabhaId}`,
        },
        (payload) => {
          const newRow = payload?.new;
          const oldRow = payload?.old;

          // refresh only if the changed row matches current FY
          const matchesFY =
            (newRow && newRow.fy === selectedFY) ||
            (oldRow && oldRow.fy === selectedFY);

          if (matchesFY) loadEntries();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sabhaId, selectedFY, loadEntries]);

  // Find potential duplicate entries (uses sabhaId, not family.sabha)
  const findPotentialDuplicates = (entry) => {
    if (!entry) return [];

    const totalAmount =
      entry?.members?.reduce((sum, m) => sum + (m?.amount || 0), 0) || 0;

    const payerName =
      entry?.members?.find((m) => m.isPrimaryPayer)?.name?.toLowerCase() ||
      entry?.members?.[0]?.name?.toLowerCase() ||
      "";

    const entryDate = new Date(entry?.submittedDate);

    const candidateEntries =
      entries?.filter(
        (e) =>
          e?.sabhaId === entry?.sabhaId &&
          e?.fy === entry?.fy &&
          (e?.entryType || "Vantiga") === (entry?.entryType || "Vantiga") &&
          e?.entryId !== entry?.entryId
      ) || [];

    const duplicates = [];

    for (const candidate of candidateEntries) {
      const candidateTotalAmount =
        candidate?.members?.reduce((sum, m) => sum + (m?.amount || 0), 0) || 0;

      const candidateDate = new Date(candidate?.submittedDate);
      const daysDiff = Math.abs((entryDate - candidateDate) / (1000 * 60 * 60 * 24));

      let matchReason = "";

      // A) Reference number match for non-cash modes
      if (
        ["Cheque", "NEFT", "UPI", "Online"].includes(entry?.paidBy) &&
        entry?.referenceNo?.trim() &&
        entry?.referenceNo === candidate?.referenceNo
      ) {
        matchReason = "Same reference number";
        duplicates.push({ ...candidate, matchReason });
        continue;
      }

      // B) Cash OR blank referenceNo
      if (entry?.paidBy === "Cash" || !entry?.referenceNo?.trim()) {
        if (
          entry?.family?.payerMobile === candidate?.family?.payerMobile &&
          totalAmount === candidateTotalAmount &&
          daysDiff <= 14
        ) {
          matchReason = "Same mobile & amount (within 14 days)";
          duplicates.push({ ...candidate, matchReason });
          continue;
        }

        if (
          entry?.family?.payerEmail === candidate?.family?.payerEmail &&
          totalAmount === candidateTotalAmount &&
          daysDiff <= 14
        ) {
          matchReason = "Same email & amount (within 14 days)";
          duplicates.push({ ...candidate, matchReason });
          continue;
        }

        const candidateName =
          candidate?.members?.find((m) => m.isPrimaryPayer)?.name?.toLowerCase() ||
          candidate?.members?.[0]?.name?.toLowerCase() ||
          "";

        if (payerName === candidateName && totalAmount === candidateTotalAmount && daysDiff <= 7) {
          matchReason = "Same payer name & amount (within 7 days)";
          duplicates.push({ ...candidate, matchReason });
          continue;
        }
      }
    }

    return duplicates
      .sort((a, b) => new Date(b.submittedDate) - new Date(a.submittedDate))
      .slice(0, 5);
  };

  const potentialDuplicates = useMemo(() => {
    if (!selectedEntry || !isDrawerOpen) return [];
    return findPotentialDuplicates(selectedEntry);
  }, [selectedEntry, isDrawerOpen, entries]);

  const filteredEntries = useMemo(() => {
    return (entries || [])
      .filter((entry) => {
        if (entry?.fy !== selectedFY) return false;

        if (userRole === "treasurer" && pratinidhiFilter && pratinidhiFilter !== "ALL") {
          const entrySubmittedBy = entry?.submittedBy || entry?.submitted_by;
          if (entrySubmittedBy !== pratinidhiFilter) return false;
        }

        if (userRole === "pratinidhi" && effectiveUserId) {
          const entrySubmittedBy = entry?.submittedBy || entry?.submitted_by;
          if (entrySubmittedBy !== effectiveUserId) return false;
        }

        const primaryName =
          entry?.members?.find((m) => m.isPrimaryPayer)?.name ||
          entry?.members?.[0]?.name ||
          "";

        if (searchQuery && !primaryName.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }

        if (statusFilter !== "ALL" && entry?.status !== statusFilter) {
          return false;
        }

        if ((entry?.entryType || "Vantiga") !== "Vantiga") return false;

        return true;
      })
      .sort((a, b) => new Date(b.submittedDate) - new Date(a.submittedDate));
  }, [selectedFY, searchQuery, statusFilter, entries, userRole, pratinidhiFilter, effectiveUserId]);

  // ✅ NEW: member-wise export rows (respects filters)
  const memberWiseRowsForExport = useMemo(() => {
    return (filteredEntries || []).flatMap((entry) => {
      const members = entry?.members || [];
      const entryTotal =
        members.reduce((sum, m) => sum + (m?.amount || 0), 0) || 0;

      const payerName =
        members.find((m) => m.isPrimaryPayer)?.name ||
        members?.[0]?.name ||
        "Unknown";

      // If no members, still export one row
      const pratinidhiName = resolvePratinidhiName(entry);

      if (!members.length) {
        return [{
          submittedDate: entry?.submittedDate,
          acknowledgedDate: entry?.acknowledgedDate,
          pratinidhiName,
          payerName,
          memberName: "",
          memberAge: "",
          memberGender: "",
          memberGotra: "",
          isPrimary: "",
          memberAmount: 0,
          entryTotal,
          entryType: entry?.entryType || "Vantiga",
          paidBy: entry?.paidBy || "",
          referenceNo: entry?.referenceNo || "",
          status: entry?.status || "",
          receiptNo: entry?.receiptNo || ""
        }];
      }

      return members.map((m) => ({
        submittedDate: entry?.submittedDate,
        acknowledgedDate: entry?.acknowledgedDate,
        pratinidhiName,
        payerName,
        memberName: m?.name || "",
        memberAge: m?.age ?? "",
        memberGender: m?.gender ?? "",
        memberGotra: getDisplayGotra(m),
        isPrimary: m?.isPrimaryPayer ? "Yes" : "No",
        memberAmount: Number(m?.amount || 0),
        entryTotal,
        entryType: entry?.entryType || "Vantiga",
        paidBy: entry?.paidBy || "",
        referenceNo: entry?.referenceNo || "",
        status: entry?.status || "",
        receiptNo: entry?.receiptNo || ""
      }));
    });
  }, [filteredEntries, resolvePratinidhiName]);

  const handleRowClick = (entry) => {
    setSelectedEntry(entry);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setAuditTrail([]);
    setTimeout(() => setSelectedEntry(null), 300);
  };

  const loadAuditTrail = useCallback(async (entryId) => {
    if (!entryId) {
      setAuditTrail([]);
      return;
    }

    setLoadingAuditTrail(true);
    try {
      const { data: rows, error } = await supabase
        .from("vantiga_entry_audit")
        .select(`
          id,
          event_type,
          edit_iteration,
          old_status,
          new_status,
          old_receipt_no,
          new_receipt_no,
          actor_user_id,
          actor_role,
          reason,
          created_at
        `)
        .eq("entry_id", entryId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const actorIds = Array.from(new Set((rows || []).map((row) => row?.actor_user_id).filter(Boolean)));
      let actorNameById = new Map();

      if (actorIds.length > 0) {
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", actorIds);

        actorNameById = new Map((profileRows || []).map((profile) => [profile.user_id, profile.full_name]));
      }

      const mapped = (rows || []).map((row) => ({
        id: row.id,
        eventType: row.event_type,
        editIteration: Number(row.edit_iteration || 0),
        oldStatus: row.old_status,
        newStatus: row.new_status,
        oldReceiptNo: row.old_receipt_no || "",
        newReceiptNo: row.new_receipt_no || "",
        actorRole: row.actor_role || "-",
        actorName: actorNameById.get(row.actor_user_id) || row.actor_user_id || "-",
        reason: row.reason || "",
        createdAt: row.created_at,
      }));

      setAuditTrail(mapped);
    } catch (error) {
      console.error("Failed to load audit trail", error);
      setAuditTrail([]);
    } finally {
      setLoadingAuditTrail(false);
    }
  }, []);

  useEffect(() => {
    if (!isDrawerOpen || !selectedEntry?.entryId) return;
    loadAuditTrail(selectedEntry.entryId);
  }, [isDrawerOpen, selectedEntry?.entryId, loadAuditTrail]);

  const formatDate = (dateString) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
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

  const toCsvValue = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const downloadCsv = (headers, rows, filename) => {
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
    const printWindow = window.open("", "_blank", "width=1300,height=900");
    if (!printWindow) return;

    printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      p { margin: 0 0 12px; color: #475569; font-size: 11px; }
      table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
      th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; text-transform: uppercase; letter-spacing: 0.02em; }
      .nowrap { white-space: nowrap; }
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

  // ✅ UPDATED: CSV export = member-wise rows
  const exportEntriesCsv = () => {
    const headers = [
      "Submitted Date",
      "Pratinidhi",
      "Acknowledged Date",
      "Payer Name (Primary)",
      "Member Name",
      "Age",
      "Gender",
      "Gotra",
      "Primary Member",
      "Member Amount",
      "Entry Total Amount",
      "Entry Type",
      "Paid By",
      "Reference",
      "Status",
      "Receipt No",
    ];

    const rows = memberWiseRowsForExport.map((r) => [
      formatDate(r.submittedDate),
      r.pratinidhiName,
      formatDate(r.acknowledgedDate),
      r.payerName,
      r.memberName || "-",
      r.memberAge,
      r.memberGender,
      r.memberGotra,
      r.isPrimary,
      r.memberAmount ?? 0,
      r.entryTotal ?? 0,
      r.entryType,
      r.paidBy,
      r.referenceNo || "-",
      r.status,
      r.receiptNo || "-",
    ]);

    downloadCsv(headers, rows, `sabha-entries-memberwise-${selectedFY}.csv`);
  };

  // ✅ UPDATED: PDF export = member-wise rows
  const exportEntriesPdf = () => {
    const rowsHtml = memberWiseRowsForExport.map((r) => `
      <tr>
        <td class="nowrap">${escapeHtml(formatDate(r.submittedDate))}</td>
        <td>${escapeHtml(r.pratinidhiName || "-")}</td>
        <td class="nowrap">${escapeHtml(formatDate(r.acknowledgedDate))}</td>
        <td>${escapeHtml(r.payerName)}</td>
        <td>${escapeHtml(r.memberName || "-")}</td>
        <td class="nowrap">${escapeHtml(r.memberAge)}</td>
        <td class="nowrap">${escapeHtml(r.memberGender)}</td>
        <td>${escapeHtml(r.memberGotra)}</td>
        <td class="nowrap">${escapeHtml(r.isPrimary || "-")}</td>
        <td class="nowrap">${escapeHtml(formatAmount(r.memberAmount))}</td>
        <td class="nowrap">${escapeHtml(formatAmount(r.entryTotal))}</td>
        <td>${escapeHtml(r.entryType || "Vantiga")}</td>
        <td>${escapeHtml(r.paidBy || "")}</td>
        <td>${escapeHtml(r.referenceNo || "-")}</td>
        <td class="nowrap">${escapeHtml(r.status || "")}</td>
        <td class="nowrap">${escapeHtml(r.receiptNo || "-")}</td>
      </tr>
    `).join("");

    const bodyHtml = `
      <h1>Sabha Entries (Member-wise Export) - FY ${escapeHtml(selectedFY)}</h1>
      <p>Rows exported: ${memberWiseRowsForExport.length} (expanded from ${filteredEntries.length} entries)</p>
      <table>
        <thead>
          <tr>
            <th>Submitted Date</th>
            <th>Pratinidhi</th>
            <th>Acknowledged Date</th>
            <th>Payer Name</th>
            <th>Member Name</th>
            <th>Age</th>
            <th>Gender</th>
            <th>Gotra</th>
            <th>Primary</th>
            <th>Member Amount</th>
            <th>Entry Total</th>
            <th>Entry Type</th>
            <th>Paid By</th>
            <th>Reference</th>
            <th>Status</th>
            <th>Receipt No</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="16">No data</td></tr>'}
        </tbody>
      </table>
    `;

    openPrintWindow(`Sabha Entries (Member-wise Export) - FY ${selectedFY}`, bodyHtml);
  };

  const showPratinidhiColumn = userRole !== "pratinidhi";

  useImperativeHandle(ref, () => ({
    exportEntriesCsv,
    exportEntriesPdf,
  }));

  const generateReceiptNumber = (fy) => {
    const existingReceiptsInFY = entries.filter((e) => e?.fy === fy && e?.receiptNo);
    const nextNumber = existingReceiptsInFY.length + 1;
    return formatReceiptNumber(effectiveReceiptCode, nextNumber);
  };

  // ✅ DB update: acknowledge (also sets acknowledged_by)
  const handleAcknowledge = async () => {
    if (!selectedEntry) return;

    setIsProcessing(true);
    try {
      const editCount = Number(selectedEntry?.editCount || 0);
      const hasReceiptBase = Boolean(selectedEntry?.receiptBaseNo);
      const currentReceipt = selectedEntry?.receiptNo || "";

      let receiptNo = currentReceipt || generateReceiptNumber(selectedEntry?.fy);

      // For edited rejected entries with prior base receipt, finalize suffix at acknowledgement.
      if (hasReceiptBase && editCount > 0) {
        const expectedBase = selectedEntry.receiptBaseNo;
        if (!currentReceipt || currentReceipt === expectedBase) {
          receiptNo = `${expectedBase}-${editCount}`;
        }
      }
      const acknowledgedDate = new Date().toISOString();

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const treasurerUserId = userData?.user?.id;
      if (!treasurerUserId) throw new Error("No active session. Please login again.");

      const { error } = await supabase
        .from("vantiga_entries")
        .update({
          status: "ACKNOWLEDGED",
          receipt_no: receiptNo,
          acknowledged_at: acknowledgedDate,
          acknowledged_by: treasurerUserId,
          rejection_reason: null,
        })
        .eq("id", selectedEntry.entryId);

      if (error) throw error;

      // refresh from DB (source of truth)
      await loadEntries();

      // keep drawer updated
      setSelectedEntry((prev) =>
        prev
          ? {
              ...prev,
              status: "ACKNOWLEDGED",
              receiptNo,
              acknowledgedDate,
              rejectionReason: null,
            }
          : prev
      );
      await loadAuditTrail(selectedEntry.entryId);
    } catch (e) {
      console.error(e);
      alert(`Failed to acknowledge: ${e.message || e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const openRejectModal = () => {
    setSelectedRejectReason("");
    setIsRejectModalOpen(true);
  };

  const closeRejectModal = () => {
    setIsRejectModalOpen(false);
    setSelectedRejectReason("");
  };

  // ✅ DB update: reject (also sets acknowledged_by)
  const handleReject = async () => {
    const isChequeBounceSelected = selectedRejectReason === "Cheque bounced.";
    const isChequePayment = selectedEntry?.paidBy === "Cheque";
    const isChequeBounceInvalid = isChequeBounceSelected && !isChequePayment;

    if (!selectedEntry || !selectedRejectReason || isChequeBounceInvalid) return;

    setIsProcessing(true);
    try {
      const reason = selectedRejectReason;

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const treasurerUserId = userData?.user?.id;
      if (!treasurerUserId) throw new Error("No active session. Please login again.");

      const { error } = await supabase
        .from("vantiga_entries")
        .update({
          status: "REJECTED",
          rejection_reason: reason,
          acknowledged_by: treasurerUserId,
          acknowledged_at: new Date().toISOString(),
          receipt_no: null,
          receipt_base_no: selectedEntry?.receiptBaseNo || selectedEntry?.receiptNo || null,
        })
        .eq("id", selectedEntry.entryId);

      if (error) throw error;

      await loadEntries();

      setSelectedEntry((prev) =>
        prev
          ? {
              ...prev,
              status: "REJECTED",
              rejectionReason: reason,
              receiptNo: "",
              receiptBaseNo: prev?.receiptBaseNo || prev?.receiptNo || "",
              acknowledgedDate: "",
            }
          : prev
      );
      await loadAuditTrail(selectedEntry.entryId);

      closeRejectModal();
    } catch (e) {
      console.error(e);
      alert(`Failed to reject: ${e.message || e}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadReceipt = () => {
    localStorage.setItem("selectedReceiptEntry", JSON.stringify(selectedEntry));
    navigate("/receipt-preview");
  };

  const handleEditRejectedEntry = () => {
    if (!selectedEntry?.entryId) return;
    navigate("/new-entry-form", {
      state: {
        prefillFY: selectedEntry?.fy,
        isRejectedEdit: true,
        entryId: selectedEntry.entryId,
      },
    });
  };

  const canEditRejectedEntry = selectedEntry?.status === "REJECTED" && Number(selectedEntry?.editCount || 0) < 2;
  const hasReachedEditLimit = selectedEntry?.status === "REJECTED" && Number(selectedEntry?.editCount || 0) >= 2;

  const isChequeBounceSelected = selectedRejectReason === "Cheque bounced.";
  const isChequePayment = selectedEntry?.paidBy === "Cheque";
  const isChequeBounceInvalid = isChequeBounceSelected && !isChequePayment;
  const canConfirmReject = Boolean(selectedRejectReason) && !isProcessing && !isChequeBounceInvalid;

  const AutoEmailNote = () => (
    <p className="text-xs text-muted-foreground">
      Receipt email is sent automatically once the receipt number is generated.
    </p>
  );

  const getAuditEventLabel = (eventType) => {
    switch (eventType) {
      case "REJECTED":
        return "Rejected";
      case "EDIT_SUBMITTED":
        return "Edited & Re-submitted";
      case "RECEIPT_ASSIGNED":
        return "Receipt Assigned";
      default:
        return eventType || "Update";
    }
  };

  const renderActions = () => {
    if (!selectedEntry) return null;
    if (userRole === "scm_office") return null;

    if (userRole === "pratinidhi") {
      if (selectedEntry?.status === "ACKNOWLEDGED") {
        return (
          <div className="flex flex-col gap-2">
            <Button onClick={handleDownloadReceipt} variant="default" fullWidth iconName="Download">
              Download Receipt
            </Button>
            <AutoEmailNote />
          </div>
        );
      }

      if (
        selectedEntry?.status === "SUBMITTED" &&
        selectedEntry?.paidBy === "Cash" &&
        selectedEntry?.receiptNo
      ) {
        return (
          <div className="flex flex-col gap-2">
            <Button onClick={handleDownloadReceipt} variant="default" fullWidth iconName="Download">
              Download Receipt
            </Button>
            <AutoEmailNote />
          </div>
        );
      }

      if (canEditRejectedEntry) {
        return (
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleEditRejectedEntry}
              variant="outline"
              fullWidth
              iconName="Pencil"
            >
              Edit Rejected Entry
            </Button>
            <p className="text-xs text-muted-foreground">
              Edit attempt {Number(selectedEntry?.editCount || 0)}/2
            </p>
          </div>
        );
      }

      if (hasReachedEditLimit) {
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Max edit limit reached (2/2). Please contact Treasurer for support.
          </div>
        );
      }

      return (
        <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <Icon name="Info" size={18} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Receipt Not Available</p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                Receipt will be available after Treasurer acknowledges the entry.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (userRole === "treasurer") {
      if (selectedEntry?.status === "SUBMITTED") {
        return (
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleAcknowledge}
              variant="success"
              fullWidth
              iconName="CheckCircle"
              loading={isProcessing}
              disabled={isProcessing}
            >
              Acknowledge Entry
            </Button>
            <Button
              onClick={openRejectModal}
              variant="destructive"
              fullWidth
              iconName="XCircle"
              disabled={isProcessing}
            >
              Reject Entry
            </Button>
          </div>
        );
      }

      if (selectedEntry?.status === "ACKNOWLEDGED") {
        return (
          <div className="flex flex-col gap-2">
            <Button onClick={handleDownloadReceipt} variant="default" fullWidth iconName="Download">
              Download Receipt
            </Button>
            <AutoEmailNote />
          </div>
        );
      }

      if (canEditRejectedEntry) {
        return (
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleEditRejectedEntry}
              variant="outline"
              fullWidth
              iconName="Pencil"
            >
              Edit Rejected Entry
            </Button>
            <p className="text-xs text-muted-foreground">
              Edit attempt {Number(selectedEntry?.editCount || 0)}/2
            </p>
          </div>
        );
      }

      if (hasReachedEditLimit) {
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Max edit limit reached (2/2). No further edits are allowed.
          </div>
        );
      }
    }

    return null;
  };

  return (
    <div className="bg-card rounded-lg border border-border shadow-sm">
      {/* Filters Section */}
      <div className="p-6 border-b border-border">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Input
              type="text"
              placeholder="Search by payer name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full"
              leftIcon={<Icon name="Search" size={18} />}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              value={statusFilter}
              onChange={(value) => setStatusFilter(value)} // ✅ fixed (no e.target.value)
              options={STATUS_OPTIONS}
              className="w-full"
            />
          </div>
          {userRole === "treasurer" && (
            <div className="w-full sm:w-56">
              <Select
                value={pratinidhiFilter}
                onChange={(value) => onPratinidhiFilterChange?.(value)}
                options={pratinidhiOptions?.length ? pratinidhiOptions : [{ value: "ALL", label: "All Pratinidhis" }]}
                className="w-full"
              />
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Showing {filteredEntries?.length} {filteredEntries?.length === 1 ? "entry" : "entries"} for FY {selectedFY}
          </span>
          <button
            className="text-xs text-primary hover:underline"
            onClick={loadEntries}
            iconName="RefreshCw"
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Table Section */}
      <div className="overflow-x-auto">
        {loadingEntries && <div className="px-6 py-4 text-sm text-muted-foreground">Loading entries…</div>}

        {entriesError && (
          <div className="px-6 py-4 text-sm text-red-600">
            Failed to load entries: {String(entriesError)}
          </div>
        )}

        {!loadingEntries && filteredEntries?.length > 0 ? (
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                  Submitted Date
                </th>
                {showPratinidhiColumn && (
                  <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                    Pratinidhi
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                  Payer Name
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                  Paid By
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                  Transaction Reference ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium bg-[#F97316] text-white uppercase tracking-wider">
                  Receipt No
                </th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-border">
              {filteredEntries.map((entry) => {
                const totalAmount =
                  entry?.members?.reduce((sum, member) => sum + (member?.amount || 0), 0) || 0;

                const payerName =
                  entry?.members?.find((m) => m.isPrimaryPayer)?.name ||
                  entry?.members?.[0]?.name ||
                  "Unknown";
                const pratinidhiName = resolvePratinidhiName(entry);

                return (
                  <tr
                    key={entry?.entryId}
                    onClick={() => handleRowClick(entry)}
                    className="hover:bg-muted/30 cursor-pointer transition-colors duration-150"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {formatDate(entry?.submittedDate)}
                    </td>
                    {showPratinidhiColumn && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                        {pratinidhiName}
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {payerName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-foreground">
                      {formatAmount(totalAmount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Icon
                          name={
                            entry?.paidBy === "Cash"
                              ? "Banknote"
                              : entry?.paidBy === "Cheque"
                              ? "Receipt"
                              : "CreditCard"
                          }
                          size={16}
                        />
                        {entry?.paidBy}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {entry?.referenceNo || "—"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(
                          entry?.status
                        )}`}
                      >
                        {entry?.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground font-mono">
                      {entry?.receiptNo || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : !loadingEntries ? (
          <div className="px-6 py-12 text-center">
            <Icon name="FileX" size={48} className="mx-auto text-muted-foreground mb-3" />
            <h3 className="text-lg font-medium text-foreground mb-1">No entries found</h3>
            <p className="text-sm text-muted-foreground">
              {searchQuery || statusFilter !== "ALL"
                ? "Try adjusting your search or filters"
                : `No entries recorded for FY ${selectedFY}`}
            </p>
          </div>
        ) : null}
      </div>

      {/* Entry Details Drawer */}
      {isDrawerOpen && selectedEntry && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300" onClick={closeDrawer} />

          <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-card shadow-2xl z-50 transform transition-transform duration-300 ease-in-out overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Entry Details</h2>
              </div>
              <button
                onClick={closeDrawer}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
                aria-label="Close drawer"
              >
                <Icon name="X" size={20} />
              </button>
            </div>

            {/* ...rest of your drawer unchanged... */}
            <div className="p-6 space-y-6">
              {selectedEntry?.status === "SUBMITTED" &&
                selectedEntry?.paidBy === "Cash" &&
                selectedEntry?.receiptNo && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <span className="font-semibold">
                      Cash Entry submitted and Receipt Generated but Acknowledgement still pending from Treasurer
                    </span>
                  </div>
              )}
              {/* (no changes below this point in your component logic/UI) */}
              {/* Payment Summary Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider border-b border-border pb-2">
                  Payment Summary
                </h3>

                <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Status
                      </label>
                      <div className="mt-1">
                      <span
                        className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border ${getStatusColor(
                          selectedEntry?.status
                        )}`}
                      >
                        {selectedEntry?.status}
                        </span>
                      </div>
                    </div>
                    {selectedEntry?.status === "REJECTED" && selectedEntry?.rejectionReason && (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        <span className="font-semibold">Entry is rejected for the following reason:</span>{" "}
                        {selectedEntry?.rejectionReason}
                      </div>
                    )}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Edit Attempts
                      </label>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {Number(selectedEntry?.editCount || 0)}/2
                      </p>
                    </div>

                  <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Financial Year
                      </label>
                      <p className="mt-1 text-base font-semibold text-foreground">{selectedEntry?.fy}</p>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Entry Type
                      </label>
                      <p className="mt-1 text-base font-semibold text-foreground">{selectedEntry?.entryType || "Vantiga"}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Amount
                      </label>
                      <p className="mt-1 text-base font-bold text-foreground">
                        {formatAmount(
                          selectedEntry?.members?.reduce((sum, m) => sum + (m?.amount || 0), 0) || 0
                        )}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Payment Mode
                      </label>
                      <p className="mt-1 text-sm font-medium text-foreground inline-flex items-center gap-1.5">
                        <Icon
                          name={
                            selectedEntry?.paidBy === "Cash"
                              ? "Banknote"
                              : selectedEntry?.paidBy === "Cheque"
                              ? "Receipt"
                              : "CreditCard"
                          }
                          size={16}
                        />
                        {selectedEntry?.paidBy}
                      </p>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Reference
                      </label>
                      <p className="mt-1 text-sm font-medium text-foreground font-mono">
                        {selectedEntry?.referenceNo || "—"}
                      </p>
                    </div>
                  </div>

                  {selectedEntry?.remarks && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Remarks
                      </label>
                      <p className="mt-1 text-sm font-medium text-foreground whitespace-pre-line bg-muted/30 p-3 rounded border border-border">
                        {selectedEntry?.remarks}
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Submitted Date
                    </label>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {formatDate(selectedEntry?.submittedDate)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Family Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider border-b border-border pb-2">
                  Family Details
                </h3>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Address
                    </label>
                    <p className="mt-1 text-sm font-medium text-foreground whitespace-pre-line bg-muted/30 p-3 rounded border border-border">
                      {selectedEntry?.family?.addressMultiLine}
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Mobile
                    </label>
                    <p className="mt-1 text-sm font-medium text-foreground">{selectedEntry?.family?.payerMobile}</p>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Email
                    </label>
                    <p className="mt-1 text-sm font-medium text-foreground break-all">{selectedEntry?.family?.payerEmail}</p>
                  </div>

                  <div className="bg-muted/30 p-4 rounded-lg border border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Directory Preferences
                    </p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-foreground">Show Amount:</span>
                        <span className="font-semibold text-foreground">{selectedEntry?.family?.optShowAmountInDirectory}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground">Show Mobile:</span>
                        <span className="font-semibold text-foreground">{selectedEntry?.family?.optShowMobileInDirectory}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-foreground">Show Email:</span>
                        <span className="font-semibold text-foreground">{selectedEntry?.family?.optShowEmailInDirectory}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                      Family Members
                    </label>
                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Name</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">Age</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Gender</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Married</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Maiden Surname</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Gotra</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {selectedEntry?.members?.map((member) => (
                            <tr key={member?.memberId} className="hover:bg-muted/20">
                              <td className="px-3 py-2 text-foreground font-medium">
                                {member?.name}
                                {member?.isPrimaryPayer}
                              </td>
                              <td className="px-3 py-2 text-center text-foreground">{member?.age}</td>
                              <td className="px-3 py-2 text-foreground">{member?.gender || "—"}</td>
                              <td className="px-3 py-2 text-foreground">{member?.isMarried ? "Yes" : "No"}</td>
                              <td className="px-3 py-2 text-foreground">{member?.maidenSurname || "—"}</td>
                              <td className="px-3 py-2 text-foreground">{getDisplayGotra(member) || "—"}</td>
                              <td className="px-3 py-2 text-right text-foreground font-semibold">
                                {formatAmount(member?.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-4 pt-4 border-t border-border">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Actions</h3>
                {renderActions()}
              </div>

              {(userRole === "pratinidhi" || userRole === "treasurer") && (
                <div className="space-y-4 pt-4 border-t border-border">
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Audit Trail</h3>
                  {loadingAuditTrail ? (
                    <p className="text-sm text-muted-foreground">Loading audit trail...</p>
                  ) : auditTrail.length > 0 ? (
                    <div className="space-y-2">
                      {auditTrail.map((audit) => (
                        <div key={audit.id} className="rounded-md border border-border p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-foreground">{getAuditEventLabel(audit.eventType)}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(audit.createdAt)}</p>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            By {audit.actorName} ({audit.actorRole || "-"})
                          </p>
                          {(audit.oldStatus || audit.newStatus) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Status: {audit.oldStatus || "-"} to {audit.newStatus || "-"}
                            </p>
                          )}
                          {(audit.oldReceiptNo || audit.newReceiptNo) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Receipt: {audit.oldReceiptNo || "-"} to {audit.newReceiptNo || "-"}
                            </p>
                          )}
                          {audit.reason && (
                            <p className="mt-1 text-xs text-foreground">
                              Reason: {audit.reason}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            Edit iteration: {Number(audit.editIteration || 0)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No audit records available yet.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Reject Modal */}
      {isRejectModalOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-[60] transition-opacity duration-300"
            onClick={closeRejectModal}
          />
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center px-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-entry-title"
          >
            <div className="w-full max-w-lg bg-card border border-border rounded-lg shadow-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <h3 id="reject-entry-title" className="text-lg font-semibold text-foreground">
                    Reject Entry
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Select a reason. This will be visible in the entry details.
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
                <div className="text-xs text-muted-foreground">
                  Payment Mode: <span className="font-semibold text-foreground">{selectedEntry?.paidBy || "-"}</span>
                </div>
                <fieldset className="space-y-3">
                  <legend className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Rejection Reason
                  </legend>
                  <div className="flex flex-col gap-2">
                    {REJECTION_REASONS.map((reason, index) => (
                      <label
                        key={reason}
                        htmlFor={`reject-reason-${index}`}
                        className="flex items-start gap-3 rounded-md border border-border px-3 py-2 text-sm text-foreground cursor-pointer hover:bg-muted/40"
                      >
                        <input
                          id={`reject-reason-${index}`}
                          type="radio"
                          name="reject-reason"
                          value={reason}
                          checked={selectedRejectReason === reason}
                          onChange={() => setSelectedRejectReason(reason)}
                          className="mt-1 h-4 w-4 text-primary"
                        />
                        <span className="leading-5">{reason}</span>
                      </label>
                    ))}
                  </div>
                  {isChequeBounceInvalid && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Cheque bounced can only be selected for entries paid via Cheque.
                    </div>
                  )}
                </fieldset>
              </div>

              <div className="px-5 py-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={closeRejectModal}
                  disabled={isProcessing}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleReject}
                  loading={isProcessing}
                  disabled={!canConfirmReject}
                  className="w-full sm:w-auto"
                >
                  Reject Entry
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

export default EntriesList;
