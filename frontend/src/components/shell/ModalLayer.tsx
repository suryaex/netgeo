/**
 * ModalLayer — the app-wide, cross-mode modal surfaces (design 12-UI §2.3):
 * Settings, Scenarios, and the first-run Onboarding wizard. All read the single
 * uiStore.activeModal slot, so at most one is ever mounted. Workspace-scoped
 * modals (device picker, import config, device library, map onboarding, fiber
 * detail) live inside their own workspace but share the same slot.
 *
 * Mounted once by AppShell. Owns the first-run onboarding trigger so onboarding
 * participates in the exclusive-modal contract instead of stacking over others.
 */
import { useEffect } from 'react';
import { useUiStore } from '@/store/uiStore';
import { ModalScrim } from './ModalScrim';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ScenariosPanel } from '@/components/ScenariosPanel';
import { OnboardingModal, ONBOARDING_KEY } from '@/components/OnboardingModal';
import { AddressingWizard } from '@/components/lab/AddressingWizard';

export function ModalLayer() {
  const activeModal = useUiStore((s) => s.activeModal);
  const openModal = useUiStore((s) => s.openModal);
  const closeModal = useUiStore((s) => s.closeModal);

  // First-run onboarding: claim the modal slot once, if nothing else holds it.
  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_KEY) === 'true') return;
    if (useUiStore.getState().activeModal === null) openModal('onboarding');
  }, [openModal]);

  const dismissOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    closeModal();
  };

  if (activeModal === 'onboarding') return <OnboardingModal onClose={dismissOnboarding} />;

  if (activeModal === 'addressingWizard') return <AddressingWizard />;

  if (activeModal === 'settings')
    return (
      <ModalScrim label="Settings" onClose={closeModal} className="max-w-3xl">
        <div className="h-[70vh]">
          <SettingsPanel />
        </div>
      </ModalScrim>
    );

  if (activeModal === 'scenarios')
    return (
      <ModalScrim label="Scenarios" onClose={closeModal} className="max-w-xl">
        <div className="flex items-center gap-2 border-b border-fg/10 px-4 py-3">
          <h2 className="text-sm font-semibold text-fg/85">Scenarios</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <ScenariosPanel />
        </div>
      </ModalScrim>
    );

  return null;
}
