import { useRef } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function classFromActive({ isActive }) {
  return `header-link ${isActive ? "active" : ""}`;
}

function quickClassFromActive({ isActive }) {
  return `header-quick-link ${isActive ? "active" : ""}`;
}

function HeaderIcon({ name }) {
  const paths = {
    attendance: "M4 19.5c0-3 3.7-4.7 8-4.7s8 1.7 8 4.7V21H4v-1.5zM12 13a4.5 4.5 0 100-9 4.5 4.5 0 000 9z",
    professional:
      "M3 17.2V21h3.8L18.3 9.5 14.5 5.7 3 17.2zm18.2-10.6a1.3 1.3 0 000-1.8L19.2 2.8a1.3 1.3 0 00-1.8 0l-1.5 1.5 3.8 3.8 1.5-1.5z",
    dashboards: "M3 3h8v8H3V3zm10 0h8v5h-8V3zM3 13h8v8H3v-8zm10-3h8v11h-8V10z",
    finance: "M3 7a2 2 0 012-2h13a1 1 0 011 1v2h1a1 1 0 011 1v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm13 4h5v2h-5a1 1 0 010-2z",
    operations:
      "M14.8 6.2a4.2 4.2 0 00-5.6 5.6L3 18l3 3 6.2-6.2a4.2 4.2 0 005.6-5.6l-2.1 2.1-3.6-3.6 2.7-1.5z",
    management: "M3 6a2 2 0 012-2h4.3l2 2H19a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z",
    home: "M3 10.5L12 3l9 7.5V21h-6v-6H9v6H3v-10.5z",
    artists: "M12 12a4.3 4.3 0 100-8.6 4.3 4.3 0 000 8.6zM4 20.5c0-3 3.8-4.8 8-4.8s8 1.8 8 4.8V21H4v-.5z",
    calendar: "M7 2v2M17 2v2M4 7h16M5 4h14a1 1 0 011 1v15a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z",
    quote:
      "M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zm3 4h8m-8 4h8m-8 4h6",
    store: "M4 8h16l-1.4 11H5.4L4 8zm3-3h10l1 3H6l1-3z",
    tattooer: "M3 17.2V21h3.8L18.3 9.5 14.5 5.7 3 17.2z",
    manager: "M3 13h8V3H3v10zm10 8h8V3h-8v18zM3 21h8v-6H3v6z",
    receivable: "M12 3v18m0 0l-5-5m5 5l5-5",
    payable: "M12 21V3m0 0l-5 5m5-5l5 5",
    cash: "M5 7h14v10H5zM3 10h2v4H3zm16 0h2v4h-2z",
    stock: "M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4m-18 5l9 4 9-4",
    commissions: "M4 19h16M7 15V9m5 6V5m5 10v-3",
    registry: "M4 5h16v14H4zM8 9h8M8 13h8",
    settings:
      "M12 8.2A3.8 3.8 0 1012 16a3.8 3.8 0 000-7.8zm8.3 4l-1.8.8c-.1.3-.2.6-.4.9l1 1.7-1.7 1.7-1.7-1c-.3.2-.6.3-.9.4l-.8 1.8h-2.4l-.8-1.8c-.3-.1-.6-.2-.9-.4l-1.7 1-1.7-1.7 1-1.7c-.2-.3-.3-.6-.4-.9l-1.8-.8v-2.4l1.8-.8c.1-.3.2-.6.4-.9l-1-1.7 1.7-1.7 1.7 1c.3-.2.6-.3.9-.4l.8-1.8h2.4l.8 1.8c.3.1.6.2.9.4l1.7-1 1.7 1.7-1 1.7c.2.3.3.6.4.9l1.8.8v2.4z",
    director: "M4 18l4-5 4 3 6-8 2 2-8 10-4-3-2 3H4z",
    menu: "M4 7h16M4 12h16M4 17h16"
  };

  return (
    <svg aria-hidden="true" className="header-svg-icon" viewBox="0 0 24 24">
      <path d={paths[name] || paths.manager} />
    </svg>
  );
}

const ATTENDANCE_LINKS = [
  { to: "/", label: "Inicio", end: true, icon: "home" },
  { to: "/artistas", label: "Artistas", icon: "artists" },
  { to: "/agendar", label: "Agendar", icon: "calendar" },
  { to: "/orcamento", label: "Orcamento", icon: "quote" },
  { to: "/loja", label: "Loja", icon: "store" }
];

const TATTOOER_LINKS = [
  { to: "/painel-tatuador", label: "Painel Tatuador", icon: "tattooer" }
];

const MANAGER_DASHBOARDS_LINKS = [
  { to: "/painel-gerente", label: "Painel Gerente", icon: "manager" },
  { to: "/painel-diretoria", label: "Painel Diretoria", icon: "director" }
];

const MANAGER_FINANCE_LINKS = [
  { to: "/financeiro/contas-receber", label: "Contas a Receber", icon: "receivable" },
  { to: "/financeiro/contas-pagar", label: "Contas a Pagar", icon: "payable" },
  { to: "/caixa", label: "Fluxo de Caixa", icon: "cash" }
];

const MANAGER_OPERATIONS_LINKS = [
  { to: "/agenda-gerencial", label: "Agenda", icon: "calendar" },
  { to: "/controle-estoque", label: "Estoque", icon: "stock" },
  { to: "/controle-comissoes", label: "Comissoes", icon: "commissions" }
];

const MANAGER_MANAGEMENT_LINKS = [
  { to: "/cadastros", label: "Cadastros", icon: "registry" },
  { to: "/configuracoes", label: "Configuracoes", icon: "settings" }
];

const PUBLIC_QUICK_LINKS = [
  { to: "/", label: "Inicio", icon: "home" },
  { to: "/artistas", label: "Artistas", icon: "artists" },
  { to: "/orcamento", label: "Orcamentos", icon: "quote" }
];

const MANAGER_QUICK_LINKS = [
  { to: "/painel-diretoria", label: "Diretoria", icon: "director" },
  { to: "/financeiro/contas-receber", label: "Recebimentos", icon: "receivable" },
  { to: "/financeiro/contas-pagar", label: "Pagamentos", icon: "payable" },
  { to: "/caixa", label: "Caixa", icon: "cash" }
];

const TATTOOER_QUICK_LINKS = [
  { to: "/painel-tatuador", label: "Painel", icon: "tattooer" },
  { to: "/cadastros", label: "Cadastros", icon: "registry" },
  { to: "/orcamento", label: "Orcamentos", icon: "quote" }
];

function renderNavGroup({ title, subtitle, icon, links, onNavigate }) {
  return (
    <div className="header-nav-group" key={title}>
      <div className="header-nav-heading">
        <span className="header-nav-group-icon" aria-hidden="true">
          <HeaderIcon name={icon} />
        </span>
        <div className="header-nav-title-block">
          <p className="header-nav-title">{title}</p>
          <p className="header-nav-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="header-nav-links">
        {links.map((link) => (
          <NavLink
            className={classFromActive}
            end={Boolean(link.end)}
            key={link.to}
            onClick={onNavigate}
            to={link.to}
          >
            <span className="header-link-icon" aria-hidden="true">
              <HeaderIcon name={link.icon} />
            </span>
            <span>{link.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function Header() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const menuDetailsRef = useRef(null);

  function handleLogout() {
    logout();
    navigate("/");
  }

  function handleMenuNavigate() {
    if (menuDetailsRef.current) {
      menuDetailsRef.current.open = false;
    }
  }

  const isManager = user?.role === "gerente";
  const isTattooer = user?.role === "tatuador";
  const roleLabel = isManager ? "Gerencia" : isTattooer ? "Profissional" : "Atendimento";
  const quickLinks = isManager ? MANAGER_QUICK_LINKS : isTattooer ? TATTOOER_QUICK_LINKS : PUBLIC_QUICK_LINKS;

  const menuGroups = [
    {
      title: "Atendimento",
      subtitle: "Relacionamento e vendas",
      icon: "attendance",
      links: ATTENDANCE_LINKS
    },
    ...(isTattooer
      ? [
        {
          title: "Profissional",
          subtitle: "Operacao do tatuador",
          icon: "professional",
          links: TATTOOER_LINKS
        }
      ]
      : []),
    ...(isManager
      ? [
        {
          title: "Paineis",
          subtitle: "Visao gerencial e diretoria",
          icon: "dashboards",
          links: MANAGER_DASHBOARDS_LINKS
        },
        {
          title: "Financeiro",
          subtitle: "Receber, pagar e caixa",
          icon: "finance",
          links: MANAGER_FINANCE_LINKS
        },
        {
          title: "Operacoes",
          subtitle: "Agenda, equipe e estoque",
          icon: "operations",
          links: MANAGER_OPERATIONS_LINKS
        },
        {
          title: "Administracao",
          subtitle: "Cadastros e configuracoes",
          icon: "management",
          links: MANAGER_MANAGEMENT_LINKS
        }
      ]
      : [])
  ];

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link className="brand" to="/">
          <span className="brand-mark">INK</span>APP
        </Link>

        <div className="header-nav-shell">
          <div className="header-command-row">
            <span className="header-role-badge">{roleLabel}</span>
            <div className="header-quick-actions">
              {quickLinks.map((quickLink) => (
                <NavLink
                  className={quickClassFromActive}
                  end={Boolean(quickLink.end)}
                  key={quickLink.to}
                  to={quickLink.to}
                >
                  <span className="header-quick-link-icon" aria-hidden="true">
                    <HeaderIcon name={quickLink.icon} />
                  </span>
                  <span>{quickLink.label}</span>
                </NavLink>
              ))}
            </div>

            <details className="header-mega" ref={menuDetailsRef}>
              <summary className="header-menu-toggle">
                <span className="header-menu-toggle-icon" aria-hidden="true">
                  <HeaderIcon name="menu" />
                </span>
                <span>Menu completo</span>
              </summary>
              <div className="header-mega-panel">
                <div className="header-mega-grid">
                  {menuGroups.map((group) => renderNavGroup({ ...group, onNavigate: handleMenuNavigate }))}
                </div>
              </div>
            </details>
          </div>
        </div>

        <div className="header-auth">
          {isAuthenticated ? (
            <>
              <span className="header-user">{user?.name}</span>
              <button className="button button-outline" onClick={handleLogout} type="button">
                Sair
              </button>
            </>
          ) : (
            <>
              <Link className="button button-outline" to="/login">
                Entrar
              </Link>
              <Link className="button button-primary" to="/cadastro">
                Criar conta
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
