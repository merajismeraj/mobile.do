import AccountMenu from "./AccountMenu";

export default function SiteHeader() {
  return (
    <header className="topbar">
      <a className="brand" href="/">
        <span className="logo" aria-hidden>&gt;_</span>
        <span>mobile<b>.do</b></span>
        <span className="tag">URL or idea → mobile app</span>
      </a>
      <AccountMenu />
    </header>
  );
}
