import { Header } from "./Header";

export function Layout({ children }) {
  return (
    <div className="app-shell">
      <Header />
      <main>{children}</main>
      <footer className="footer">
        <div className="container footer-inner">
          <p>InkApp © {new Date().getFullYear()} | Gestão para estúdios de tatuagem e piercing</p>
        </div>
      </footer>
    </div>
  );
}
