import { type ReactNode, useState } from "react";
import { IconButton, Switch, Text, Tooltip } from "@radix-ui/themes";
import {
  BarChart3,
  Calendar,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Settings,
  Sun,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ConnectionBadge } from "../ConnectionBadge/ConnectionBadge.tsx";
import logoSrc from "../../assets/chargeha_soft-plug_light.svg";
import styles from "./AppLayout.module.css";

export type Page =
  | "dashboard"
  | "stats"
  | "schedules"
  | "logs"
  | "settings"
  | "simulator";

interface AppLayoutProps {
  children: ReactNode;
  appearance: "light" | "dark";
  onToggleAppearance: () => void;
  activePage: Page;
  onNavigate: (page: Page) => void;
  authMode?: string;
  onLogout?: () => void;
}

const NAV_ITEMS: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "stats", label: "Stats", icon: BarChart3 },
  { page: "schedules", label: "Schedules", icon: Calendar },
  { page: "logs", label: "Logs", icon: ScrollText },
  { page: "simulator", label: "Simulator", icon: FlaskConical },
  { page: "settings", label: "Settings", icon: Settings },
];

function MobileMenu(
  { activePage, authMode, onLogout, handleNavigate }: {
    activePage: Page;
    authMode?: string;
    onLogout?: () => void;
    handleNavigate: (page: Page) => void;
  },
) {
  return (
    <div className={styles.mobileMenu}>
      <nav className={styles.mobileNav}>
        {NAV_ITEMS.map(({ page, label, icon: Icon }) => (
          <Text
            key={page}
            size="3"
            weight="medium"
            className={activePage === page
              ? styles.mobileNavLinkActive
              : styles.mobileNavLink}
            onClick={() => handleNavigate(page)}
          >
            <Icon size={16} />
            {label}
          </Text>
        ))}
      </nav>
      {authMode && authMode !== "none" && onLogout && (
        <div className={styles.mobileMenuFooter}>
          <Tooltip content="Log out">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={onLogout}
              aria-label="Log out"
            >
              <LogOut size={14} />
            </IconButton>
          </Tooltip>
          <Text size="2" color="gray">Log out</Text>
        </div>
      )}
    </div>
  );
}

export function AppLayout(
  {
    children,
    appearance,
    onToggleAppearance,
    activePage,
    onNavigate,
    authMode,
    onLogout,
  }: AppLayoutProps,
) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavigate = (page: Page) => {
    setMobileMenuOpen(false);
    onNavigate(page);
  };

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div
          className={styles.brand}
          onClick={() => handleNavigate("dashboard")}
        >
          <img src={logoSrc} alt="ChargeHA" className={styles.logo} />
          <Text size="5" weight="bold">
            Charge<span className={styles.accent}>HA</span>
          </Text>
        </div>
        <nav className={styles.nav}>
          {NAV_ITEMS.map(({ page, label }) => (
            <Text
              key={page}
              size="2"
              weight="medium"
              className={activePage === page
                ? styles.navLinkActive
                : styles.navLink}
              onClick={() => onNavigate(page)}
            >
              {label}
            </Text>
          ))}
        </nav>
        <div className={styles.status}>
          <ConnectionBadge />
          {appearance === "dark" ? <Moon size={14} /> : <Sun size={14} />}
          <Switch
            size="1"
            checked={appearance === "dark"}
            onCheckedChange={onToggleAppearance}
          />
          {authMode && authMode !== "none" && onLogout && (
            <span className={styles.statusLogout}>
              <Tooltip content="Log out">
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={onLogout}
                  aria-label="Log out"
                >
                  <LogOut size={14} />
                </IconButton>
              </Tooltip>
            </span>
          )}
        </div>
        {/* Mobile hamburger button */}
        <IconButton
          size="2"
          variant="ghost"
          color="gray"
          className={styles.menuButton}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </IconButton>
      </header>
      {mobileMenuOpen && (
        <MobileMenu
          activePage={activePage}
          authMode={authMode}
          onLogout={onLogout}
          handleNavigate={handleNavigate}
        />
      )}
      <main className={styles.main}>{children}</main>
    </div>
  );
}
