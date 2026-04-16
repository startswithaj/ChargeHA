import { useEffect, useMemo, useState } from "react";
import { DollarSign, Zap } from "lucide-react";
import { Text } from "@radix-ui/themes";
import type { DayOfWeek } from "@chargeha/shared";
import { type RouterOutputs, trpc } from "../../../trpc.ts";
import { SettingsSection } from "./SettingsLayout.tsx";
import { CurrencyConfig } from "./CurrencyConfig.tsx";
import { PresetTemplates } from "./PresetTemplates.tsx";
import { TariffPeriodsSection } from "./TariffPeriodsSection.tsx";
import {
  detectGaps,
  detectOverlaps,
  EMPTY_FORM,
  gapToFormData,
  type PeriodFormData,
} from "./tariffUtils.ts";

export type TariffPeriod = RouterOutputs["tariff"]["list"]["periods"][number];

function useTariffMutations(
  setShowAddForm: (v: boolean) => void,
  setEditingId: (v: number | null) => void,
  setForm: (v: PeriodFormData) => void,
) {
  const utils = trpc.useUtils();
  const saveDefaultsMutation = trpc.tariff.updateDefaultRate.useMutation({
    onSuccess: () => {
      utils.tariff.list.invalidate();
      utils.tariff.currentRate.invalidate();
    },
  });
  const presetMutation = trpc.tariff.loadPreset.useMutation({
    onSuccess: () => {
      utils.tariff.list.invalidate();
      setShowAddForm(false);
      setEditingId(null);
    },
  });
  const addMutation = trpc.tariff.create.useMutation({
    onSuccess: () => {
      utils.tariff.list.invalidate();
      setForm({ ...EMPTY_FORM });
      setShowAddForm(false);
    },
  });
  const updateMutation = trpc.tariff.update.useMutation({
    onSuccess: () => {
      utils.tariff.list.invalidate();
      utils.tariff.currentRate.invalidate();
      setEditingId(null);
      setForm({ ...EMPTY_FORM });
    },
  });
  const deleteMutation = trpc.tariff.delete.useMutation({
    onSuccess: () => {
      utils.tariff.list.invalidate();
    },
  });
  return {
    saveDefaultsMutation,
    presetMutation,
    addMutation,
    updateMutation,
    deleteMutation,
  };
}

function useOverlapAnalysis(
  tariffConfig:
    | NonNullable<RouterOutputs["tariff"]["list"]>
    | null,
  showAddForm: boolean,
  editingId: number | null,
  form: PeriodFormData,
) {
  return useMemo(() => {
    if (!tariffConfig) return { overlapErrors: [], gapWarnings: [] };
    const formActive = showAddForm || editingId !== null;
    const existingPeriods = tariffConfig.periods
      .filter((p) => p.id !== editingId)
      .map((p) => ({
        label: p.label,
        startTime: p.startTime,
        endTime: p.endTime,
        days: p.days,
      }));
    const formPeriod = {
      label: form.label || "(new period)",
      startTime: form.startTime,
      endTime: form.endTime,
      days: form.days,
    };
    const allPeriods = formActive
      ? [...existingPeriods, formPeriod]
      : existingPeriods;
    const overlaps = formActive ? detectOverlaps(allPeriods) : [];
    const gaps = allPeriods.length > 0 ? detectGaps(allPeriods) : [];
    return { overlapErrors: overlaps, gapWarnings: gaps };
  }, [tariffConfig, showAddForm, editingId, form]);
}

function useTariffHandlers(
  {
    form,
    editingId,
    saveDefaultsMutation,
    presetMutation,
    addMutation,
    updateMutation,
    deleteMutation,
    setShowAddForm,
    setEditingId,
    setForm,
    setFormError,
    setConfirmPreset,
    localSymbol,
    localCode,
    localDefaultRate,
    gapWarnings,
  }: {
    form: PeriodFormData;
    editingId: number | null;
    saveDefaultsMutation: ReturnType<
      typeof trpc.tariff.updateDefaultRate.useMutation
    >;
    presetMutation: ReturnType<typeof trpc.tariff.loadPreset.useMutation>;
    addMutation: ReturnType<typeof trpc.tariff.create.useMutation>;
    updateMutation: ReturnType<typeof trpc.tariff.update.useMutation>;
    deleteMutation: ReturnType<typeof trpc.tariff.delete.useMutation>;
    setShowAddForm: (v: boolean) => void;
    setEditingId: (v: number | null) => void;
    setForm: (v: PeriodFormData) => void;
    setFormError: (v: string | null) => void;
    setConfirmPreset: (v: string | null) => void;
    localSymbol: string;
    localCode: string;
    localDefaultRate: string;
    gapWarnings: ReturnType<typeof detectGaps>;
  },
) {
  const handleSaveDefaults = () => {
    const rate = parseFloat(localDefaultRate);
    if (isNaN(rate) || rate < 0) return;
    saveDefaultsMutation.mutate({
      ratePerKwh: rate,
      currencySymbol: localSymbol,
      currencyCode: localCode,
    });
  };

  const handlePreset = (template: string) => {
    setConfirmPreset(null);
    presetMutation.mutate({ template });
  };

  const handleAdd = () => {
    const rate = parseFloat(form.ratePerKwh);
    if (isNaN(rate) || rate < 0) {
      setFormError("Rate must be a number >= 0");
      return;
    }
    setFormError(null);
    addMutation.mutate({
      label: form.label.trim(),
      startTime: form.startTime,
      endTime: form.endTime,
      days: form.days as [DayOfWeek, ...DayOfWeek[]],
      ratePerKwh: rate,
    });
  };

  const handleUpdate = () => {
    if (editingId === null) return;
    const rate = parseFloat(form.ratePerKwh);
    if (isNaN(rate) || rate < 0) {
      setFormError("Rate must be a number >= 0");
      return;
    }
    setFormError(null);
    updateMutation.mutate({
      id: editingId,
      label: form.label.trim(),
      startTime: form.startTime,
      endTime: form.endTime,
      days: form.days as [DayOfWeek, ...DayOfWeek[]],
      ratePerKwh: rate,
    });
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id });
  };

  const startEdit = (period: TariffPeriod) => {
    addMutation.reset();
    setEditingId(period.id);
    setShowAddForm(false);
    setFormError(null);
    setForm({
      label: period.label,
      startTime: period.startTime,
      endTime: period.endTime,
      days: [...period.days],
      ratePerKwh: String(period.ratePerKwh),
    });
  };

  const startAdd = () => {
    updateMutation.reset();
    setShowAddForm(true);
    setEditingId(null);
    setFormError(null);
    setForm(gapToFormData(gapWarnings));
  };

  return {
    handleSaveDefaults,
    handlePreset,
    handleAdd,
    handleUpdate,
    handleDelete,
    startEdit,
    startAdd,
  };
}

function useTariffState() {
  const {
    data: tariffConfig = null,
    isPending: loading,
    isError: hasQueryError,
    error: queryError,
  } = trpc.tariff.list.useQuery();

  const [confirmPreset, setConfirmPreset] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PeriodFormData>({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [localSymbol, setLocalSymbol] = useState("");
  const [localCode, setLocalCode] = useState("");
  const [localDefaultRate, setLocalDefaultRate] = useState("");

  useEffect(() => {
    if (tariffConfig) {
      setLocalSymbol(tariffConfig.currencySymbol);
      setLocalCode(tariffConfig.currencyCode);
      setLocalDefaultRate(String(tariffConfig.defaultRatePerKwh));
    }
  }, [tariffConfig]);

  return {
    tariffConfig,
    loading,
    hasQueryError,
    queryError,
    confirmPreset,
    setConfirmPreset,
    showAddForm,
    setShowAddForm,
    editingId,
    setEditingId,
    form,
    setForm,
    formError,
    setFormError,
    localSymbol,
    setLocalSymbol,
    localCode,
    setLocalCode,
    localDefaultRate,
    setLocalDefaultRate,
  };
}

function isDefaultsDirty(
  state: ReturnType<typeof useTariffState>,
): boolean {
  if (state.tariffConfig === null) return false;
  if (state.localSymbol !== state.tariffConfig.currencySymbol) return true;
  if (state.localCode !== state.tariffConfig.currencyCode) return true;
  return state.localDefaultRate !==
    String(state.tariffConfig.defaultRatePerKwh);
}

function computeDisplayError(
  hasQueryError: boolean,
  queryError: unknown,
  mutations: { error: unknown }[],
): string | null {
  if (hasQueryError) {
    return queryError instanceof Error
      ? queryError.message
      : "Failed to load tariffs";
  }
  const found = mutations.find((m) => m.error);
  return (found?.error as { message?: string })?.message ?? null;
}

export function TariffSettings() {
  const state = useTariffState();
  const mutations = useTariffMutations(
    state.setShowAddForm,
    state.setEditingId,
    state.setForm,
  );
  const { overlapErrors, gapWarnings } = useOverlapAnalysis(
    state.tariffConfig,
    state.showAddForm,
    state.editingId,
    state.form,
  );
  const handlers = useTariffHandlers({
    form: state.form,
    editingId: state.editingId,
    saveDefaultsMutation: mutations.saveDefaultsMutation,
    presetMutation: mutations.presetMutation,
    addMutation: mutations.addMutation,
    updateMutation: mutations.updateMutation,
    deleteMutation: mutations.deleteMutation,
    setShowAddForm: state.setShowAddForm,
    setEditingId: state.setEditingId,
    setForm: state.setForm,
    setFormError: state.setFormError,
    setConfirmPreset: state.setConfirmPreset,
    localSymbol: state.localSymbol,
    localCode: state.localCode,
    localDefaultRate: state.localDefaultRate,
    gapWarnings,
  });

  if (state.loading) {
    return (
      <SettingsSection
        icon={<Zap size={18} />}
        title="Electricity Tariffs"
        description="Loading tariff configuration..."
      >
        <Text size="2" color="gray">Loading...</Text>
      </SettingsSection>
    );
  }

  const displayError = computeDisplayError(
    state.hasQueryError,
    state.queryError,
    [
      mutations.saveDefaultsMutation,
      mutations.presetMutation,
      mutations.deleteMutation,
    ],
  );

  const addFormError = state.showAddForm
    ? mutations.addMutation.error?.message
    : null;
  const editFormError = state.editingId !== null
    ? mutations.updateMutation.error?.message
    : null;
  const computedFormError = state.formError ?? addFormError ?? editFormError ??
    null;

  const defaultsDirty = isDefaultsDirty(state);

  return (
    <TariffSettingsView
      tariffConfig={state.tariffConfig}
      displayError={displayError}
      localSymbol={state.localSymbol}
      localCode={state.localCode}
      localDefaultRate={state.localDefaultRate}
      defaultsDirty={defaultsDirty}
      savingDefault={mutations.saveDefaultsMutation.isPending}
      setLocalSymbol={state.setLocalSymbol}
      setLocalCode={state.setLocalCode}
      setLocalDefaultRate={state.setLocalDefaultRate}
      handleSaveDefaults={handlers.handleSaveDefaults}
      confirmPreset={state.confirmPreset}
      setConfirmPreset={state.setConfirmPreset}
      handlePreset={handlers.handlePreset}
      editingId={state.editingId}
      showAddForm={state.showAddForm}
      form={state.form}
      computedFormError={computedFormError}
      hasOverlaps={overlapErrors.length > 0}
      overlapErrors={overlapErrors}
      gapWarnings={gapWarnings}
      setForm={state.setForm}
      startAdd={handlers.startAdd}
      startEdit={handlers.startEdit}
      handleUpdate={handlers.handleUpdate}
      setEditingId={state.setEditingId}
      setFormError={state.setFormError}
      handleAdd={handlers.handleAdd}
      setShowAddForm={state.setShowAddForm}
      handleDelete={handlers.handleDelete}
    />
  );
}

function TariffSettingsView(
  props: {
    tariffConfig: ReturnType<typeof useTariffState>["tariffConfig"];
    displayError: string | null;
    localSymbol: string;
    localCode: string;
    localDefaultRate: string;
    defaultsDirty: boolean;
    savingDefault: boolean;
    setLocalSymbol: (v: string) => void;
    setLocalCode: (v: string) => void;
    setLocalDefaultRate: (v: string) => void;
    handleSaveDefaults: () => void;
    confirmPreset: string | null;
    setConfirmPreset: (v: string | null) => void;
    handlePreset: (template: string) => void;
    editingId: number | null;
    showAddForm: boolean;
    form: PeriodFormData;
    computedFormError: string | null;
    hasOverlaps: boolean;
    overlapErrors: ReturnType<typeof detectOverlaps>;
    gapWarnings: ReturnType<typeof detectGaps>;
    setForm: (v: PeriodFormData) => void;
    startAdd: () => void;
    startEdit: (period: TariffPeriod) => void;
    handleUpdate: () => void;
    setEditingId: (v: number | null) => void;
    setFormError: (v: string | null) => void;
    handleAdd: () => void;
    setShowAddForm: (v: boolean) => void;
    handleDelete: (id: number) => void;
  },
) {
  const {
    tariffConfig,
    displayError,
    localSymbol,
    localCode,
    localDefaultRate,
    defaultsDirty,
    savingDefault,
    setLocalSymbol,
    setLocalCode,
    setLocalDefaultRate,
    handleSaveDefaults,
    confirmPreset,
    setConfirmPreset,
    handlePreset,
    editingId,
    showAddForm,
    form,
    computedFormError,
    hasOverlaps,
    overlapErrors,
    gapWarnings,
    setForm,
    startAdd,
    startEdit,
    handleUpdate,
    setEditingId,
    setFormError,
    handleAdd,
    setShowAddForm,
    handleDelete,
  } = props;
  return (
    <SettingsSection
      icon={<DollarSign size={18} />}
      title="Electricity Tariffs"
      description="Configure your electricity rates to track charging costs and solar savings."
    >
      {displayError && <Text size="2" color="red">{displayError}</Text>}

      <CurrencyConfig
        localSymbol={localSymbol}
        localCode={localCode}
        localDefaultRate={localDefaultRate}
        defaultsDirty={defaultsDirty}
        savingDefault={savingDefault}
        onSymbolChange={setLocalSymbol}
        onCodeChange={setLocalCode}
        onDefaultRateChange={setLocalDefaultRate}
        onSave={handleSaveDefaults}
      />

      <PresetTemplates
        hasPeriods={(tariffConfig?.periods.length ?? 0) > 0}
        confirmPreset={confirmPreset}
        onConfirmPreset={setConfirmPreset}
        onLoadPreset={handlePreset}
        onCancelConfirm={() => setConfirmPreset(null)}
      />

      <TariffPeriodsSection
        periods={tariffConfig?.periods ?? []}
        editingId={editingId}
        showAddForm={showAddForm}
        form={form}
        formError={computedFormError}
        hasOverlaps={hasOverlaps}
        overlapErrors={overlapErrors}
        gapWarnings={gapWarnings}
        currencySymbol={localSymbol || "$"}
        onFormChange={setForm}
        onStartAdd={startAdd}
        onStartEdit={startEdit}
        onUpdate={handleUpdate}
        onCancelEdit={() => {
          setEditingId(null);
          setFormError(null);
        }}
        onAdd={handleAdd}
        onCancelAdd={() => {
          setShowAddForm(false);
          setFormError(null);
        }}
        onDelete={handleDelete}
      />
    </SettingsSection>
  );
}
