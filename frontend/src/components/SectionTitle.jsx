export function SectionTitle({ eyebrow, title, subtitle }) {
  return (
    <div className="section-title">
      {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}
