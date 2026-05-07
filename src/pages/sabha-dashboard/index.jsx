import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Icon from '../../components/AppIcon';
import CommonHeader from '../../components/ui/CommonHeader';
import EntriesList from './components/EntriesList';
import SummaryView from './components/SummaryView';
import RemittancesTab from './components/RemittancesTab';
import { getCurrentFinancialYear, getFinancialYearOptions } from '../../utils/financialYear';

// ✅ adjust import path to where your client lives
import { supabase } from '../../supabaseClient';

async function getUserSabhaContextOrThrow() {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;

  const uid = userData?.user?.id;
  if (!uid) throw new Error('No active session. Please login again.');

  const { data: rows, error } = await supabase
    .from('user_sabha_roles')
    .select(`
      role,
      sabha_id,
      sabhas:sabha_id ( id, code, receipt_code, name )
    `)
    .eq('user_id', uid)
    .eq('is_active', true);

  if (error) throw error;
  if (!rows || rows.length === 0) {
    throw new Error('Sabha is not mapped to your user. Please contact admin.');
  }

  const pratinidhiRow = rows.find(r => r.role === 'pratinidhi') || rows[0];

  return {
    userId: uid,
    role: pratinidhiRow.role,
    sabhaId: pratinidhiRow.sabha_id,
    sabhaName: pratinidhiRow.sabhas?.name,
    sabhaCode: pratinidhiRow.sabhas?.code,
    receiptCode: pratinidhiRow.sabhas?.receipt_code,
  };
}

const SabhaDashboard = () => {
  const navigate = useNavigate();
  const [userProfile, setUserProfile] = useState(null);
  const fyOptions = getFinancialYearOptions();
  const defaultFY = getCurrentFinancialYear();
  const [selectedFY, setSelectedFY] = useState(defaultFY);
  const [summaryMode, setSummaryMode] = useState('single');
  const [summaryFYs, setSummaryFYs] = useState([defaultFY]);
  const [compareFYError, setCompareFYError] = useState('');
  const [activeTab, setActiveTab] = useState('entries');
  const [isExportOpen, setIsExportOpen] = useState(false);
  const exportRef = useRef(null);
  const entriesExportRef = useRef(null);
  const summaryExportRef = useRef(null);
  const remittancesExportRef = useRef(null);

  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesError, setEntriesError] = useState(null);
  const [pratinidhiFilter, setPratinidhiFilter] = useState('ALL');
  const [pratinidhiOptions, setPratinidhiOptions] = useState([
    { value: 'ALL', label: 'All Pratinidhis' }
  ]);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
      if (!isAuthenticated) {
        navigate('/login', { replace: true });
        return;
      }

      const profile = JSON.parse(localStorage.getItem('userProfile') || '{}');

      if (profile?.role === 'scm_office' || profile?.role === 'general_manager') {
        navigate('/scm-office-dashboard', { replace: true });
        return;
      }

      let nextProfile = profile;

      try {
        const ctx = await getUserSabhaContextOrThrow();
        nextProfile = {
          ...profile,
          user_id: ctx?.userId || profile?.user_id,
          role: ctx?.role || profile?.role,
          sabhaId: ctx?.sabhaId || profile?.sabhaId,
          sabha: ctx?.sabhaName || profile?.sabha,
          receiptCode: ctx?.receiptCode || profile?.receiptCode,
        };

        localStorage.setItem('userProfile', JSON.stringify(nextProfile));
        if (ctx?.sabhaId) {
          localStorage.setItem('sabha_id', ctx.sabhaId);
        }
      } catch (err) {
        console.warn('Failed to load sabha role mapping:', err);
      }

      if (!isMounted) return;
      setUserProfile(nextProfile);
    };

    init();
    return () => {
      isMounted = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (userProfile?.role !== 'treasurer' && activeTab === 'remittances') {
      setActiveTab('entries');
    }
  }, [userProfile?.role, activeTab]);

  const handleFYChange = (value) => setSelectedFY(value);

  const normalizeFYOrder = (values) => {
    const order = fyOptions.map((opt) => opt.value);
    return [...new Set(values)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  };

  const handleSummaryFYChange = (values) => {
    const nextValues = normalizeFYOrder(values || []);
    if (nextValues.length > 3) {
      setCompareFYError('You can compare up to 3 FYs only.');
      return;
    }
    setCompareFYError('');
    setSummaryFYs(nextValues);
  };

  const handleSummaryModeChange = (mode) => {
    setSummaryMode(mode);
    setCompareFYError('');
    if (mode === 'single') {
      setSummaryFYs([selectedFY]);
    } else if (summaryFYs.length === 0) {
      setSummaryFYs([selectedFY]);
    }
  };

  const handleNewEntry = () => {
    navigate('/new-entry-form', { state: { prefillFY: selectedFY } });
  };

  const handleExportPdf = () => {
    setIsExportOpen(false);
    if (activeTab === 'entries') {
      entriesExportRef.current?.exportEntriesPdf?.();
      return;
    }
    if (activeTab === 'remittances') {
      remittancesExportRef.current?.exportRemittancesPdf?.();
      return;
    }
    summaryExportRef.current?.exportSummaryPdf?.();
  };

  const handleExportCsv = () => {
    setIsExportOpen(false);
    if (activeTab === 'entries') {
      entriesExportRef.current?.exportEntriesCsv?.();
      return;
    }
    if (activeTab === 'remittances') {
      remittancesExportRef.current?.exportRemittancesCsv?.();
      return;
    }
    summaryExportRef.current?.exportSummaryCsv?.();
  };

  // ✅ Fetch entries from Supabase (single source of truth)
  const fetchEntries = useCallback(async () => {
    if (!userProfile?.sabhaId) return;

    const fyList =
      activeTab === 'summary' && summaryMode === 'compare'
        ? summaryFYs
        : [selectedFY];

    if (!fyList?.length) return;

    setLoadingEntries(true);
    setEntriesError(null);

    try {
      const userId = userProfile?.user_id || userProfile?.userId || null;
      let query = supabase
        .from('vantiga_entries')
        .select(`
          id, fy, entry_type, status, paid_by, reference_no, receipt_no, submitted_by,
          submitted_at, acknowledged_at, rejection_reason,
          sabha_id, family_id,
          families (
            id, sabha_id, family_code, address_multiline, payer_mobile, payer_email,
            opt_show_amount_in_directory, opt_show_mobile_in_directory, opt_show_email_in_directory,
            family_members (
              id, full_name, age, gender, gotra, other_gotra, is_married, maiden_surname, amount, is_primary_payer
            )
          )
        `)
        .eq('sabha_id', userProfile.sabhaId)
        .in('fy', fyList);

      if (userProfile?.role === 'pratinidhi' && userId) {
        query = query.eq('submitted_by', userId);
      }

      const { data, error } = await query.order('submitted_at', { ascending: false });

      if (error) throw error;
      setEntries(data || []);
    } catch (e) {
      console.error('Failed to load entries', e);
      setEntriesError(e?.message || 'Failed to load entries');
      setEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  }, [userProfile?.sabhaId, selectedFY, summaryMode, summaryFYs, activeTab]);

  // Load entries on FY/sabha change
  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    if (summaryMode === 'single') {
      setSummaryFYs([selectedFY]);
    }
  }, [selectedFY, summaryMode]);

  useEffect(() => {
    if (userProfile?.role !== 'treasurer') {
      setPratinidhiFilter('ALL');
      setPratinidhiOptions([{ value: 'ALL', label: 'All Pratinidhis' }]);
      return;
    }

    const scopedEntries =
      activeTab === 'summary' && summaryMode === 'compare'
        ? entries
        : (entries || []).filter((entry) => entry?.fy === selectedFY);

    const ids = Array.from(
      new Set((scopedEntries || [])
        .map((entry) => entry?.submitted_by || entry?.submittedBy)
        .filter(Boolean))
    );

    if (ids.length === 0) {
      setPratinidhiOptions([{ value: 'ALL', label: 'All Pratinidhis' }]);
      if (pratinidhiFilter !== 'ALL') setPratinidhiFilter('ALL');
      return;
    }

    let isMounted = true;

    const loadPratinidhis = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', ids);

      if (!isMounted) return;

      if (error) {
        console.warn('Failed to load pratinidhi profiles:', error);
      }

      const nameById = new Map((data || []).map((row) => [row.user_id, row.full_name]));
      const options = ids
        .map((id) => ({ value: id, label: nameById.get(id) || id }))
        .sort((a, b) => a.label.localeCompare(b.label));

      setPratinidhiOptions([{ value: 'ALL', label: 'All Pratinidhis' }, ...options]);
      if (pratinidhiFilter !== 'ALL' && !ids.includes(pratinidhiFilter)) {
        setPratinidhiFilter('ALL');
      }
    };

    loadPratinidhis();

    return () => {
      isMounted = false;
    };
  }, [entries, userProfile?.role, pratinidhiFilter, selectedFY, summaryMode, summaryFYs, activeTab]);

  useEffect(() => {
    if (!isExportOpen) return;
    const handleClickOutside = (event) => {
      if (exportRef?.current && !exportRef.current.contains(event?.target)) {
        setIsExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExportOpen]);

  // ✅ Realtime: auto-refresh list when entries change
  useEffect(() => {
    if (!userProfile?.sabhaId) return;

    const fyList =
      activeTab === 'summary' && summaryMode === 'compare'
        ? summaryFYs
        : [selectedFY];

    if (!fyList?.length) return;

    const channel = supabase.channel(`vantiga_entries_${userProfile.sabhaId}_${fyList.join('_')}`);

    channel
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT/UPDATE/DELETE
          schema: 'public',
          table: 'vantiga_entries',
          filter: `sabha_id=eq.${userProfile.sabhaId}`
        },
        (payload) => {
          // Only refetch when the FY matches (payload.new exists for INSERT/UPDATE)
          const newRow = payload?.new;
          const oldRow = payload?.old;

          const fyChangedOrMatches =
            (newRow && fyList.includes(newRow.fy)) ||
            (oldRow && fyList.includes(oldRow.fy));

          if (fyChangedOrMatches) {
            fetchEntries();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userProfile?.sabhaId, selectedFY, summaryMode, summaryFYs, activeTab, fetchEntries]);

  // Keep parent entries in sync if child updates (optional)
  const handleEntriesUpdate = (updatedEntries) => {
    setEntries(updatedEntries);
  };

  const roleLabel = userProfile?.role === 'treasurer' ? 'Treasurer' : 'Pratinidhi';
  const dashboardTitle =
    userProfile?.role === 'pratinidhi'
      ? 'Sabha Dashboard - Pratinidhi'
      : userProfile?.role === 'treasurer'
      ? 'Sabha Dashboard - Treasurer'
      : 'Sabha Dashboard';
  const isSummaryTab = activeTab === 'summary' && userProfile?.role === 'treasurer';
  const isCompareMode = summaryMode === 'compare';
  const summaryFYSelection = isCompareMode ? summaryFYs : [selectedFY];
  const isExportDisabled = isSummaryTab && summaryFYSelection.length === 0;

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <CommonHeader />

      <div className="bg-card border-b border-border shadow-sm">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <h2 className="text-3xl font-bold text-card-foreground mb-2">
                {dashboardTitle}
              </h2>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon name="MapPin" size={16} />
                <p className="text-base font-medium">
                  {userProfile?.sabha || roleLabel}
                </p>
              </div>
            </div>

            <div className="w-full sm:w-auto">
              {isSummaryTab ? (
                <div className="flex flex-col gap-3 items-start sm:items-end">
                  <div className="flex items-center gap-1 bg-muted p-1 rounded-md">
                    <button
                      onClick={() => handleSummaryModeChange('single')}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        summaryMode === 'single'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Single FY
                    </button>
                    <button
                      onClick={() => handleSummaryModeChange('compare')}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        summaryMode === 'compare'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Compare FYs
                    </button>
                  </div>

                  <div className="w-full sm:w-64">
                    <Select
                      value={isCompareMode ? summaryFYs : selectedFY}
                      onChange={isCompareMode ? handleSummaryFYChange : handleFYChange}
                      options={fyOptions}
                      label="View FY (filter)"
                      placeholder="Select FY"
                      multiple={isCompareMode}
                      clearable={isCompareMode}
                    />
                  </div>

                  {isCompareMode && (
                    <>
                      <div className="flex flex-wrap gap-2 w-full sm:w-64">
                        {summaryFYs.length > 0 ? (
                          summaryFYs.map((fy) => (
                            <span
                              key={fy}
                              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-foreground"
                            >
                              {fy}
                              <button
                                type="button"
                                onClick={() => handleSummaryFYChange(summaryFYs.filter((item) => item !== fy))}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={`Remove ${fy}`}
                              >
                                <Icon name="X" size={12} />
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">No FY selected</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground w-full sm:w-64">
                        Select 2-3 FYs to compare.
                      </p>
                      {compareFYError && (
                        <p className="text-xs text-red-600 w-full sm:w-64">{compareFYError}</p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="w-full sm:w-48">
                  <Select
                    value={selectedFY}
                    onChange={handleFYChange}
                    options={fyOptions}
                    label="View FY (filter)"
                    placeholder="Select FY"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 bg-muted p-1 rounded-md">
                <button
                  onClick={() => setActiveTab('entries')}
                  className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
                    activeTab === 'entries'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Entries
                </button>
                <button
                  onClick={() => setActiveTab('summary')}
                  className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
                    activeTab === 'summary'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Summary
                </button>
                {userProfile?.role === 'treasurer' && (
                  <button
                    onClick={() => setActiveTab('remittances')}
                    className={`px-4 py-2 text-sm font-medium rounded transition-colors ${
                      activeTab === 'remittances'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Remittances
                  </button>
                )}
              </div>

              {userProfile?.role === 'pratinidhi' && (
                <div className="flex flex-col items-end gap-1">
                  <Button
                    variant="outline"
                    size="default"
                    onClick={handleNewEntry}
                    iconName="Plus"
                    iconPosition="left"
                    className= "bg-[#F97316] text-white"
                  >
                    New Entry
                  </Button>
                  <p className="hidden text-xs text-muted-foreground sm:block">
                    New Entry opens with selected FY prefilled; you can change FY in the form.
                  </p>
                </div>
              )}
              {userProfile?.role === 'treasurer' && (
                <div className="relative" ref={exportRef}>
                  <button
                    onClick={() => !isExportDisabled && setIsExportOpen((prev) => !prev)}
                    disabled={isExportDisabled}
                    className={`inline-flex items-center gap-0 sm:gap-2 px-3 py-2 rounded-md border border-border bg-card text-sm ${
                      isExportDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/30'
                    }`}
                  >
                    <Icon name="Download" size={16} />
                    <span className="sr-only sm:not-sr-only sm:inline">Export</span>
                  </button>
                  {isExportOpen && !isExportDisabled && (
                    <div className="absolute right-0 mt-2 w-40 bg-popover border border-border rounded-md shadow-lg z-50">
                      <button
                        onClick={handleExportPdf}
                        className="w-full inline-flex items-center gap-0 sm:gap-2 text-left px-3 py-2 text-sm hover:bg-muted"
                      >
                        <Icon name="FileText" size={16} />
                        <span className="sr-only sm:not-sr-only sm:inline">Export PDF</span>
                      </button>
                      <button
                        onClick={handleExportCsv}
                        className="w-full inline-flex items-center gap-0 sm:gap-2 text-left px-3 py-2 text-sm hover:bg-muted"
                      >
                        <Icon name="Download" size={16} />
                        <span className="sr-only sm:not-sr-only sm:inline">Export CSV</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {userProfile?.role === 'pratinidhi' && (
              <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:hidden">
                <Icon name="Info" size={14} className="mt-0.5 shrink-0" />
                <p>
                  New Entry opens with selected FY prefilled; you can change FY in the form.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {activeTab === 'entries' && (
          <>
            {entriesError && (
              <div className="mb-4 p-3 rounded border border-red-300 text-red-700">
                {entriesError}
              </div>
            )}
            <EntriesList
              ref={entriesExportRef}
              selectedFY={selectedFY}
              userRole={userProfile?.role}
              sabhaId={userProfile?.sabhaId}
              receiptCode={userProfile?.receiptCode}
              currentUserId={userProfile?.user_id || userProfile?.userId}
              onEntriesUpdate={handleEntriesUpdate}
              pratinidhiFilter={pratinidhiFilter}
              pratinidhiOptions={pratinidhiOptions}
              onPratinidhiFilterChange={setPratinidhiFilter}
            />

          </>
        )}

        {activeTab === 'summary' && (
          <SummaryView
            ref={summaryExportRef}
            selectedFY={selectedFY}
            selectedFYs={summaryFYs}
            summaryMode={summaryMode}
            fyOptions={fyOptions}
            userProfile={userProfile}
            entries={entries} // ✅ summary uses same supabase-backed entries
            pratinidhiFilter={pratinidhiFilter}
            pratinidhiOptions={pratinidhiOptions}
            onPratinidhiFilterChange={setPratinidhiFilter}
          />
        )}

        {activeTab === 'remittances' && userProfile?.role === 'treasurer' && (
          <RemittancesTab
            ref={remittancesExportRef}
            selectedFY={selectedFY}
            userProfile={userProfile}
          />
        )}
      </main>
    </div>
  );
};

export default SabhaDashboard;
