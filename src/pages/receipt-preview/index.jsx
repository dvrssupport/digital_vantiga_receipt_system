import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import Button from '../../components/ui/Button';
import CommonHeader from 'components/ui/CommonHeader';
import { supabase } from '../../supabaseClient';
import { amountToWordsIndian, formatAmountIndian } from '../../utils/amount';

const formatDate = (dateString) => {
  try {
    const d = dateString ? new Date(dateString) : new Date();
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
};

const toReceiptFileSafeName = (receiptNo) => {
  const value = String(receiptNo || '').trim();
  if (!value || value === '-') return 'Receipt';
  return `Receipt-${value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()}`;
};

const getStandaloneFallback = () => ({
  receiptNo: 'PREVIEW-001',
  fy: '2025-26',
  entryType: 'Vantiga',
  paidBy: 'UPI',
  referenceNo: 'N/A',
  acknowledgedDate: new Date().toISOString(),
  family: {
    payerMobile: '9000000000',
    payerEmail: 'sample@example.com',
    addressMultiLine: 'Sample Address Line 1\nSample Address Line 2',
    sabha: 'Shirali',
    optShowAmountInDirectory: 'Yes',
    optShowMobileInDirectory: 'No',
    optShowEmailInDirectory: 'Yes'
  },
  members: [
    {
      memberId: '1',
      name: 'Sample Member',
      age: 35,
      gender: 'M',
      gotra: 'Kashyap',
      amount: 5000,
      isPrimaryPayer: true
    }
  ]
});

const mapDbEntryToReceiptEntry = (dbEntry, fallbackEntry = {}) => {
  const family = dbEntry?.families || {};
  const members = Array.isArray(family?.family_members) ? family.family_members : [];

  return {
    ...fallbackEntry,
    entryId: dbEntry?.id || fallbackEntry?.entryId || fallbackEntry?.id,
    id: dbEntry?.id || fallbackEntry?.id || fallbackEntry?.entryId,
    fy: dbEntry?.fy || fallbackEntry?.fy || '-',
    entryType: dbEntry?.entry_type || fallbackEntry?.entryType || 'Vantiga',
    paidBy: dbEntry?.paid_by ?? '-',
    referenceNo: dbEntry?.reference_no ?? '',
    receiptNo: dbEntry?.receipt_no || fallbackEntry?.receiptNo || '-',
    submittedDate: dbEntry?.submitted_at || fallbackEntry?.submittedDate || fallbackEntry?.submitted_at || null,
    submittedBy: dbEntry?.submitted_by || fallbackEntry?.submittedBy || fallbackEntry?.submitted_by || null,
    submitted_by: dbEntry?.submitted_by || fallbackEntry?.submitted_by || fallbackEntry?.submittedBy || null,
    acknowledgedBy: dbEntry?.acknowledged_by || fallbackEntry?.acknowledgedBy || fallbackEntry?.acknowledged_by || null,
    acknowledged_by: dbEntry?.acknowledged_by || fallbackEntry?.acknowledged_by || fallbackEntry?.acknowledgedBy || null,
    acknowledgedDate: dbEntry?.acknowledged_at || fallbackEntry?.acknowledgedDate || null,
    family: {
      ...(fallbackEntry?.family || {}),
      familyId: family?.id || fallbackEntry?.family?.familyId,
      addressMultiLine: family?.address_multiline || fallbackEntry?.family?.addressMultiLine || '-',
      payerMobile: family?.payer_mobile || fallbackEntry?.family?.payerMobile || '',
      payerEmail: family?.payer_email || fallbackEntry?.family?.payerEmail || '',
      sabha: family?.sabhas?.name || fallbackEntry?.family?.sabha || null,
      optShowAmountInDirectory:
        typeof family?.opt_show_amount_in_directory === 'boolean'
          ? (family.opt_show_amount_in_directory ? 'Yes' : 'No')
          : (fallbackEntry?.family?.optShowAmountInDirectory || 'No'),
      optShowMobileInDirectory:
        typeof family?.opt_show_mobile_in_directory === 'boolean'
          ? (family.opt_show_mobile_in_directory ? 'Yes' : 'No')
          : (fallbackEntry?.family?.optShowMobileInDirectory || 'No'),
      optShowEmailInDirectory:
        typeof family?.opt_show_email_in_directory === 'boolean'
          ? (family.opt_show_email_in_directory ? 'Yes' : 'No')
          : (fallbackEntry?.family?.optShowEmailInDirectory || 'No')
    },
    members: members.length
      ? members.map((m) => ({
          memberId: m?.id,
          name: m?.full_name || '-',
          age: m?.age,
          gender: m?.gender,
          gotra: m?.gotra === 'Others' ? (m?.other_gotra || 'Others') : m?.gotra,
          amount: Number(m?.amount || 0),
          isPrimaryPayer: !!m?.is_primary_payer
        }))
      : (Array.isArray(fallbackEntry?.members) ? fallbackEntry.members : [])
  };
};

const ReceiptPreview = ({ standalone = false }) => {
  const navigate = useNavigate();
  const receiptHeaderUrl = new URL('../../../Screenshot 2026-03-30 182157.png', import.meta.url).href;
  const [entry, setEntry] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const initialTitleRef = useRef(document.title);
  const receiptSheetRef = useRef(null);

  // fetched from Supabase profiles (instead of email)
  const [pratinidhiName, setPratinidhiName] = useState('-');
  const [treasurerName, setTreasurerName] = useState('-');

  useEffect(() => {
    let isMounted = true;

    async function loadReceiptEntry() {
      const storedEntry = localStorage.getItem('selectedReceiptEntry');
      const storedProfile = localStorage.getItem('userProfile');

      if (!storedEntry) {
        if (standalone) {
          setEntry(getStandaloneFallback());
          setUserProfile({
            sabha: 'Shirali',
            name: 'Preview User'
          });
          return;
        }
        navigate('/sabha-dashboard', { replace: true });
        return;
      }

      try {
        const parsedEntry = JSON.parse(storedEntry);
        const parsedProfile = storedProfile ? JSON.parse(storedProfile) : null;

        if (!isMounted) return;
        setUserProfile(parsedProfile);

        const entryId = parsedEntry?.entryId || parsedEntry?.id;
        if (!entryId) {
          setEntry(parsedEntry);
          return;
        }

        const { data, error } = await supabase
          .from('vantiga_entries')
          .select(`
            id, fy, entry_type, paid_by, reference_no, receipt_no, submitted_at, submitted_by, acknowledged_by, acknowledged_at,
            families:family_id (
              id,
              address_multiline,
              payer_mobile,
              payer_email,
              opt_show_amount_in_directory,
              opt_show_mobile_in_directory,
              opt_show_email_in_directory,
              sabhas:sabha_id ( name ),
              family_members (
                id, full_name, age, gender, gotra, other_gotra, amount, is_primary_payer
              )
            )
          `)
          .eq('id', entryId)
          .single();

        if (!isMounted) return;

        if (error || !data) {
          console.warn('Receipt fallback to local cache, Supabase fetch failed:', error);
          setEntry(parsedEntry);
          return;
        }

        setEntry(mapDbEntryToReceiptEntry(data, parsedEntry));
      } catch (e) {
        console.error('Error loading receipt data:', e);
        if (!isMounted) return;

        if (standalone) {
          setEntry(getStandaloneFallback());
          setUserProfile({
            sabha: 'Shirali',
            name: 'Preview User'
          });
          return;
        }
        navigate('/sabha-dashboard', { replace: true });
      }
    }

    loadReceiptEntry();

    return () => {
      isMounted = false;
    };
  }, [navigate, standalone]);

  useEffect(() => {
    return () => {
      document.title = initialTitleRef.current;
    };
  }, []);

  useEffect(() => {
    document.title = toReceiptFileSafeName(entry?.receiptNo);
  }, [entry?.receiptNo]);

  // Load Pratinidhi full name from Supabase profiles
  useEffect(() => {
    async function loadPratinidhiName() {
      if (!entry) return;

      const submittedBy =
        entry?.submitted_by ||
        entry?.submittedBy ||
        entry?.submitted_by_user_id ||
        entry?.submittedByUserId ||
        null;

      let userIdToLookup = submittedBy;

      if (!userIdToLookup) {
        try {
          const { data: userData, error: userErr } = await supabase.auth.getUser();
          if (!userErr && userData?.user?.id) userIdToLookup = userData.user.id;
        } catch {
          // ignore
        }
      }

      if (!userIdToLookup && userProfile?.userId) userIdToLookup = userProfile.userId;

      if (!userIdToLookup) {
        setPratinidhiName('-');
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', userIdToLookup)
        .single();

      if (!error && data?.full_name) {
        setPratinidhiName(data.full_name);
      } else {
        const fallback =
          userProfile?.name ||
          (userProfile?.email ? userProfile.email.split('@')[0] : '-');
        setPratinidhiName(fallback);
      }
    }

    loadPratinidhiName();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  // Load Treasurer full name from Supabase profiles (acknowledged_by)
  useEffect(() => {
    async function loadTreasurerName() {
      if (!entry) return;

      const acknowledgedBy =
        entry?.acknowledged_by ||
        entry?.acknowledgedBy ||
        null;

      if (!acknowledgedBy) {
        setTreasurerName('-');
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', acknowledgedBy)
        .single();

      if (!error && data?.full_name) {
        setTreasurerName(data.full_name);
      } else {
        setTreasurerName('-');
      }
    }

    loadTreasurerName();
  }, [entry]);

  const handleBack = () => navigate('/sabha-dashboard');

  const base64ToBlob = (base64, mimeType = 'application/pdf') => {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const downloadReceiptPreviewAsPdf = async () => {
    const receiptNode = receiptSheetRef.current;
    if (!receiptNode) {
      throw new Error('Receipt preview is not available for download.');
    }

    const canvas = await html2canvas(receiptNode, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: receiptNode.scrollWidth,
      windowHeight: receiptNode.scrollHeight
    });

    const imageData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imageHeight = (canvas.height * usableWidth) / canvas.width;

    let remainingHeight = imageHeight;
    let positionY = margin;

    pdf.addImage(imageData, 'PNG', margin, positionY, usableWidth, imageHeight);
    remainingHeight -= usableHeight;

    while (remainingHeight > 0) {
      positionY = remainingHeight - imageHeight + margin;
      pdf.addPage();
      pdf.addImage(imageData, 'PNG', margin, positionY, usableWidth, imageHeight);
      remainingHeight -= usableHeight;
    }

    pdf.save(`${toReceiptFileSafeName(entry?.receiptNo)}.pdf`);
  };

  const handleDownloadPdf = async () => {
    if (isDownloadingPdf) return;

    try {
      setIsDownloadingPdf(true);
      const entryId = entry?.entryId || entry?.id;
      const receiptNo = entry?.receiptNo;

      if (entryId && receiptNo && receiptNo !== '-') {
        const { data, error } = await supabase.functions.invoke('generate-receipt-pdf', {
          body: { entry_id: entryId, receipt_no: receiptNo }
        });

        if (error) throw error;
        if (!data?.ok || !data?.pdf_base64) {
          throw new Error(data?.error || 'Failed to generate receipt PDF');
        }

        const blob = base64ToBlob(data.pdf_base64, 'application/pdf');
        const filename = data?.filename || `${toReceiptFileSafeName(entry?.receiptNo)}.pdf`;
        downloadBlob(blob, filename);
        return;
      }
      throw new Error('Receipt number is missing; PDF cannot be generated.');
    } catch (error) {
      console.error('Failed to generate receipt PDF:', error);
      window.alert('Unable to download receipt right now. Please try again.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const members = useMemo(() => (Array.isArray(entry?.members) ? entry.members : []), [entry]);
  const primaryPayer = useMemo(() => members.find((m) => m?.isPrimaryPayer) || null, [members]);
  const primaryPayerName = useMemo(
    () => primaryPayer?.name || members?.[0]?.name || '-',
    [primaryPayer, members]
  );
  const isMathMaryada = entry?.entryType === 'Math Maryada';

  if (!entry) return null;

  if (isMathMaryada) {
    return (
      <div className="min-h-screen bg-background">
        <div className={`print:hidden ${standalone ? 'hidden' : ''}`}>
          <CommonHeader />
        </div>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
          <div className="max-w-lg w-full bg-white border border-slate-300 rounded-lg shadow-sm p-6 text-center">
            <div className="text-xl font-semibold text-slate-900">Receipt Unsupported</div>
            <p className="mt-3 text-sm text-slate-600">
              Math Maryada receipts are no longer available in the application UI.
            </p>
            {!standalone && (
              <div className="mt-5">
                <Button variant="outline" onClick={handleBack} iconName="ArrowLeft" iconPosition="left">
                  Back to Dashboard
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const totalAmount = members.reduce((sum, m) => sum + (Number(m?.amount) || 0), 0);
  const amountInWords = amountToWordsIndian(totalAmount);

  const receiptDate = formatDate(entry?.acknowledgedDate || entry?.submittedDate || new Date().toISOString());

  const paidBy = String(entry?.paidBy || '').trim() || '-';
  const referenceNoRaw = String(entry?.referenceNo ?? '').trim();
  const referenceNo = referenceNoRaw || (paidBy === 'Cash' ? 'Not Applicable' : '-');

  const payerMobile = entry?.family?.payerMobile ? `+91 ${entry.family.payerMobile}` : '-';
  const payerEmail = entry?.family?.payerEmail || '-';
  const address = entry?.family?.addressMultiLine || '-';

  const collectingSabha = entry?.family?.sabha || userProfile?.sabha || '-';

  const optShowAmount = entry?.family?.optShowAmountInDirectory || 'No';
  const optShowMobile = entry?.family?.optShowMobileInDirectory || 'No';
  const optShowEmail = entry?.family?.optShowEmailInDirectory || 'No';
  const tableRows = [...members, ...Array(Math.max(0, 5 - members.length)).fill(null)];

  return (
    <div className="min-h-screen bg-background">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 12mm;
        }
        @media screen {
          .receipt-sheet {
            width: 186mm;
            min-height: 273mm;
          }
        }
        @media print {
          .receipt-sheet {
            width: 186mm;
            min-height: 273mm;
            margin: 0 auto;
          }
          .receipt-sheet,
          .receipt-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
      {/* Common Header */}
      <div className={`print:hidden ${standalone ? 'hidden' : ''}`}>
        <CommonHeader />
      </div>

      <div className="min-h-screen bg-gray-50 print:bg-white text-slate-900">
        {/* Controls (hidden in print) */}
        <div className="print:hidden bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <Button variant="outline" onClick={handleBack} iconName="ArrowLeft" iconPosition="left">
              Back to Dashboard
            </Button>
            <Button
              variant="default"
              onClick={handleDownloadPdf}
              iconName="Download"
              iconPosition="left"
              disabled={isDownloadingPdf}
            >
              {isDownloadingPdf ? 'Preparing PDF...' : 'Download Receipt'}
            </Button>
          </div>
        </div>

        {/* Receipt */}
        <div className="container mx-auto px-4 py-8 print:py-0">
          <div ref={receiptSheetRef} className="receipt-sheet w-full max-w-full mx-auto bg-white border border-gray-300 shadow-sm print:shadow-none text-sm">
            <div className="px-4 pt-3 pb-2 border-b border-slate-300">
              <img
                src={receiptHeaderUrl}
                alt="Shri Chitrapur Math receipt header"
                className="w-full h-auto"
              />
            </div>

            <div className="px-6 py-2.5 border-b border-slate-300 flex items-start justify-between">
              <div>
                <div className="text-lg font-bold">Vantiga Receipt</div>
                <div className="text-sm font-semibold mt-0.5">Local Sabha: {collectingSabha}</div>
              </div>
              <div className="text-sm leading-tight text-right font-semibold">
                <div>
                  Receipt number:{' '}
                  <span className="font-mono">{entry?.receiptNo || '-'}</span>
                </div>
                <div>
                  Date: <span className="font-medium">{receiptDate}</span>
                </div>
              </div>
            </div>

            <div className="px-6 py-2 border-b border-slate-300 text-center">
              <div className="inline-block text-sm italic bg-yellow-200 border border-yellow-300 px-3 py-1 rounded-md">
                Vantiga is a voluntary contribution towards the activities of Shri Chitrapur Math.
              </div>
            </div>

            <div className="px-6 py-2.5 border-b border-slate-300 flex items-start justify-between gap-4 text-base font-semibold">
              <div>
                Received From : <span className="font-normal">{primaryPayerName}</span>
              </div>
              <div className="text-right whitespace-nowrap">
                Vantiga for the year: <span className="text-sm font-mono font-normal">{entry?.fy || '-'}</span>
              </div>
            </div>

            <div className="border-b border-slate-300 px-6 py-2 space-y-2">
              <div className="text-base font-semibold">
                Address: <span className="text-sm whitespace-pre-line leading-snug font-normal">{address}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-base font-semibold">
                <div>
                  Mobile Number: <span className="text-sm font-mono font-normal">{payerMobile}</span>
                </div>
                <div className="sm:text-right">
                  Email ID: <span className="text-sm break-all font-mono font-normal">{payerEmail}</span>
                </div>
              </div>
            </div>

            <div className="px-6 pb-2">
              <div className="text-base font-semibold mb-1.5">Vantiga Payer Details:</div>
              <div className="border border-slate-300 rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-300">
                      <th className="text-left px-3 py-2 w-[41%]">Name</th>
                      <th className="text-left px-3 py-2 w-[10%]">Age</th>
                      <th className="text-left px-3 py-2 w-[14%]">Gender</th>
                      <th className="text-left px-3 py-2 w-[15%]">Gotra</th>
                      <th className="text-center px-3 py-2 w-[20%]">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((m, idx) => (
                      <tr key={m?.memberId || `blank-${idx}`} className="border-b border-slate-200">
                        <td className="px-3 py-2">{m?.name || ''}</td>
                        <td className="px-3 py-2">{m?.age ?? ''}</td>
                        <td className="px-3 py-2">{m?.gender ?? ''}</td>
                        <td className="px-3 py-2">{m?.gotra ?? ''}</td>
                        <td className="px-3 py-2 text-right">{m ? formatAmountIndian(m?.amount) : ''}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td colSpan={4} className="px-3 py-2 text-right">TOTAL</td>
                      <td className="px-3 py-2 text-right">{formatAmountIndian(totalAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-1.5 text-base font-semibold">
                AMOUNT IN WORDS: <span className="font-medium"> Rupees</span>
                <span className="font-medium">{amountInWords}</span>
                <span className="font-medium"> Only</span>
              </div>
            </div>

            <div className="border-t border-slate-300 px-6 py-2.5">
              <div className="text-sm mb-1.5">
                <span className="font-semibold">Payment Mode:</span>{' '}
                <span className="font-mono">{paidBy}</span>
              </div>
              <div className="text-sm">
                <span className="font-semibold">Reference Number:</span>{' '}
                <span className="font-mono">{referenceNo}</span>
              </div>
            </div>

            <div className="border-t border-slate-300 px-6 py-2.5 bg-slate-100">
              <div className="flex justify-center mb-3">
                <div className="text-sm text-center leading-snug">
                  <span className="inline-block bg-yellow-200 border border-yellow-300 px-3 py-1 rounded-md">
                    Vantiga Payer has confirmed below preferences for display in{' '}
                    <span className="font-semibold">SCM Vantiga Directory:</span>
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="font-semibold">Vantiga Amount:</span> {optShowAmount}
                </div>
                <div>
                  <span className="font-semibold">Mobile Number:</span> {optShowMobile}
                </div>
                <div>
                  <span className="font-semibold">Email ID:</span> {optShowEmail}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-300 px-6 py-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
                <div>
                  <div className="font-semibold">Pratinidhi:</div>
                  <div className="mt-1">{pratinidhiName}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">Treasurer:</div>
                  <div className="mt-1">{treasurerName}</div>
                </div>
              </div>
            </div>

            <div className="px-6 pb-3 pt-1 text-center">
              <div className="text-[11px] text-slate-600 font-medium print:text-[10px]">
                No Signature required as this is a computer generated receipt
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptPreview;
