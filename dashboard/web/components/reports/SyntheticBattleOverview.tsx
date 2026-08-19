import type { SyntheticBattleOverviewModel, SyntheticReportSide } from "@/lib/synthetic-report";

export interface SyntheticBattleOverviewProps {
  report: SyntheticBattleOverviewModel;
  bannerDataUrl?: string;
  avatarsAreFramed?: boolean;
}

const number = new Intl.NumberFormat("en-US");

function displayPower(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${number.format(value)}`;
}

function Avatar({ side, role }: { side: SyntheticReportSide; role: "attacker" | "defender" }) {
  return (
    <div className={`synthetic-avatar synthetic-avatar--${role}`}>
      {side.avatarDataUrl ? (
        // This component is also rendered outside Next by the standalone proof script.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={side.avatarDataUrl} alt="" />
      ) : (
        <span>{side.name.replace(/^\[[^\]]+\]/, "").trim().slice(0, 1).toUpperCase()}</span>
      )}
      <span className="synthetic-role-icon" aria-hidden="true" />
      {role === "defender" ? <span className="synthetic-inspect-icon" aria-hidden="true" /> : null}
    </div>
  );
}

function SideIdentity({
  side,
  role,
}: {
  side: SyntheticReportSide;
  role: "attacker" | "defender";
}) {
  return (
    <div className={`synthetic-identity synthetic-identity--${role}`}>
      <Avatar side={side} role={role} />
      <div className="synthetic-player-name">{side.name}</div>
      <div className="synthetic-coordinates">{side.coordinates ?? "SIMULATOR"}</div>
      <div className="synthetic-power-change">
        <span className="synthetic-power-icon">✊</span>
        <span>{displayPower(side.powerChange)}</span>
      </div>
    </div>
  );
}

function OutcomeRow({
  label,
  left,
  right,
  alert = false,
}: {
  label: string;
  left: number;
  right: number;
  alert?: boolean;
}) {
  return (
    <div className={`synthetic-outcome-row${alert ? " synthetic-outcome-row--alert" : ""}`}>
      <span>{number.format(left)}</span>
      <strong>
        {label}
        {label === "Lightly Injured" ? <i className="synthetic-info-icon">!</i> : null}
      </strong>
      <span>{number.format(right)}</span>
    </div>
  );
}

export function SyntheticBattleOverview({
  report,
  bannerDataUrl,
  avatarsAreFramed = false,
}: SyntheticBattleOverviewProps) {
  const resultLabel =
    report.winner === "draw" ? "DRAW" : report.winner === "left" ? "VICTORY!" : "DEFEAT";

  return (
    <main
      id="synthetic-report"
      className={`synthetic-report${avatarsAreFramed ? " synthetic-report--framed-avatars" : ""}`}
    >
      <header className="synthetic-mail-header">
        <span className="synthetic-back" aria-hidden="true" />
        <strong>Mail</strong>
        <span className="synthetic-close" aria-hidden="true">×</span>
      </header>

      <div className="synthetic-page">
        <section
          className={`synthetic-scene${bannerDataUrl ? " synthetic-scene--art" : ""}`}
          style={bannerDataUrl ? { backgroundImage: `url(${bannerDataUrl})` } : undefined}
          aria-label="Synthetic battle metadata"
        >
          <div className="synthetic-scene-shape synthetic-scene-shape--one" />
          <div className="synthetic-scene-shape synthetic-scene-shape--two" />
          <div className="synthetic-scene-shield">◆</div>
          {!bannerDataUrl ? (
            <>
              <div className="synthetic-scene-meta synthetic-scene-meta--left">X:789 Y:573</div>
              <div className="synthetic-scene-meta synthetic-scene-meta--right">{report.timestamp}</div>
            </>
          ) : null}
          <div className="synthetic-provenance">SIMULATED · {String(report.seed)}</div>
        </section>

        <section className="synthetic-overview">
          <div className="synthetic-section-title">Battle Overview</div>
          <div className="synthetic-versus">
            <div className="synthetic-result-burst" aria-hidden="true">✦</div>
            <div className="synthetic-result-label">{resultLabel}</div>
            <SideIdentity side={report.left} role="attacker" />
            <SideIdentity side={report.right} role="defender" />
          </div>
          <div className="synthetic-outcomes">
            <OutcomeRow label="Troops" left={report.left.initialTroops} right={report.right.initialTroops} />
            <OutcomeRow label="Losses" left={report.left.losses} right={report.right.losses} />
            <OutcomeRow label="Injured" left={report.left.injured} right={report.right.injured} alert />
            <OutcomeRow
              label="Lightly Injured"
              left={report.left.lightlyInjured}
              right={report.right.lightlyInjured}
            />
            <OutcomeRow label="Survivors" left={report.left.survivors} right={report.right.survivors} />
          </div>
          <span className="synthetic-next" aria-hidden="true" />
        </section>
      </div>
    </main>
  );
}

export const syntheticBattleOverviewCss = String.raw`
  :root {
    color-scheme: only light;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    background: #1e476a;
  }

  .synthetic-report {
    width: 720px;
    overflow: hidden;
    color: #735d4e;
    font-family: "WOS Report", Loma, "Arial Rounded MT Bold", sans-serif;
    font-weight: 700;
  }

  .synthetic-mail-header {
    height: 86px;
    padding: 0 18px;
    display: grid;
    grid-template-columns: 62px 1fr 62px;
    align-items: center;
    color: white;
    background: #204a70;
    font-size: 39px;
    letter-spacing: -1px;
    font-family: "Lilita One", "WOS Report", Loma, sans-serif;
    font-weight: 400;
    text-shadow: 0 3px 0 #102d45, 2px 0 0 #102d45, -2px 0 0 #102d45;
  }

  .synthetic-back {
    width: 48px;
    height: 28px;
    position: relative;
    border: 3px solid white;
    border-left: 0;
    border-radius: 0 8px 8px 0;
    background: #9cecff;
    filter: drop-shadow(0 4px 1px #0d3554);
  }

  .synthetic-back::before {
    content: "";
    position: absolute;
    left: -17px;
    top: -10px;
    border-top: 21px solid transparent;
    border-bottom: 21px solid transparent;
    border-right: 24px solid white;
  }

  .synthetic-back::after {
    content: "";
    position: absolute;
    left: -12px;
    top: -6px;
    border-top: 17px solid transparent;
    border-bottom: 17px solid transparent;
    border-right: 20px solid #9cecff;
  }

  .synthetic-close {
    justify-self: end;
    color: #d9fbff;
    font-family: sans-serif;
    font-size: 66px;
    font-weight: 700;
    line-height: 1;
    filter: drop-shadow(0 3px 1px #0d3554);
  }

  .synthetic-page {
    min-height: 834px;
    padding: 24px 25px 20px;
    background: #f8e9dc;
    border-radius: 24px 24px 0 0;
  }

  .synthetic-scene {
    height: 144px;
    position: relative;
    overflow: hidden;
    border-radius: 22px;
    background:
      radial-gradient(circle at 18% 76%, #dbfbff 0 8px, transparent 9px),
      radial-gradient(circle at 83% 71%, #dbfbff 0 9px, transparent 10px),
      linear-gradient(118deg, #168ac9 0 34%, #24a9dd 34% 62%, #0d73b6 62% 100%);
    box-shadow: inset 0 0 0 2px rgb(255 255 255 / 18%);
  }

  .synthetic-scene--art {
    background-repeat: no-repeat;
    background-position: center;
    background-size: cover;
  }

  .synthetic-scene--art::before,
  .synthetic-scene--art::after,
  .synthetic-scene--art .synthetic-scene-shape,
  .synthetic-scene--art .synthetic-scene-shield {
    display: none;
  }

  .synthetic-scene::before,
  .synthetic-scene::after {
    content: "";
    position: absolute;
    bottom: -48px;
    width: 170px;
    height: 150px;
    border-radius: 52% 52% 0 0;
    background: #27648a;
    opacity: 0.88;
    transform: rotate(14deg);
  }

  .synthetic-scene::before { left: 172px; }
  .synthetic-scene::after { right: 126px; transform: rotate(-12deg); }

  .synthetic-scene-shape {
    position: absolute;
    bottom: -36px;
    width: 42px;
    height: 128px;
    border-radius: 24px 24px 8px 8px;
    background: #183e5e;
    opacity: 0.82;
  }

  .synthetic-scene-shape--one { left: 146px; transform: rotate(-18deg); }
  .synthetic-scene-shape--two { right: 119px; transform: rotate(18deg); }

  .synthetic-scene-shield {
    position: absolute;
    left: 318px;
    top: 38px;
    color: #c6e6ef;
    font-family: sans-serif;
    font-size: 86px;
    transform: scaleX(1.25);
    text-shadow: 0 5px 0 #173c59;
  }

  .synthetic-scene-meta {
    position: absolute;
    top: 14px;
    z-index: 2;
    color: white;
    font-size: 25px;
    line-height: 1;
    letter-spacing: -0.5px;
    -webkit-text-stroke: 1.2px #17405e;
    paint-order: stroke fill;
    text-shadow: 0 2px 0 #17405e;
  }

  .synthetic-scene-meta--left { left: 16px; }
  .synthetic-scene-meta--right { right: 16px; }

  .synthetic-provenance {
    position: absolute;
    z-index: 4;
    right: 10px;
    bottom: 7px;
    padding: 3px 8px 2px;
    border-radius: 999px;
    color: rgb(239 251 255 / 78%);
    background: rgb(14 67 104 / 42%);
    font-family: Loma, sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.8px;
  }

  .synthetic-overview {
    margin-top: 13px;
    overflow: hidden;
    border: 3px solid #c4ad9d;
    border-radius: 18px;
    background: #fff8f1;
  }

  .synthetic-section-title {
    height: 54px;
    display: grid;
    place-items: center;
    color: white;
    background:
      linear-gradient(135deg, transparent 0 18px, rgb(255 255 255 / 8%) 19px 34px, transparent 35px) 0 0 / 80px 54px,
      #cbb5a5;
    border-bottom: 3px solid #a98f7c;
    font-size: 32px;
    line-height: 1;
    letter-spacing: -1px;
    font-family: "Lilita One", "WOS Report", Loma, sans-serif;
    font-weight: 400;
    -webkit-text-stroke: 1.6px #715d50;
    paint-order: stroke fill;
    text-shadow: 0 3px 0 #715d50;
  }

  .synthetic-versus {
    height: 286px;
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    background:
      linear-gradient(101deg, transparent 0 49.5%, rgb(255 255 255 / 32%) 49.7% 50.3%, transparent 50.5%),
      linear-gradient(101deg, #ef333d 0 50%, #1878cc 50.2% 100%);
  }

  .synthetic-versus::after {
    content: "";
    position: absolute;
    inset: 126px 0 0;
    background: linear-gradient(to bottom, transparent, #f7eae0 98%);
    pointer-events: none;
  }

  .synthetic-result-burst {
    position: absolute;
    z-index: 3;
    left: 50%;
    top: 50px;
    transform: translateX(-50%);
    width: 128px;
    height: 128px;
    top: 29px;
    color: transparent;
    background:
      linear-gradient(90deg, transparent 45%, #ffd93a 46% 54%, transparent 55%),
      linear-gradient(0deg, transparent 45%, #ffd93a 46% 54%, transparent 55%);
    filter: drop-shadow(0 0 8px #fff29b);
    transform: translateX(-50%);
  }

  .synthetic-result-burst::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, transparent 45%, #ffe34d 46% 54%, transparent 55%),
      linear-gradient(0deg, transparent 45%, #ffe34d 46% 54%, transparent 55%);
    transform: rotate(45deg);
  }

  .synthetic-result-label {
    position: absolute;
    z-index: 4;
    left: 50%;
    top: 73px;
    min-width: 230px;
    padding: 3px 24px 0;
    transform: translateX(-50%);
    text-align: center;
    color: white;
    background: linear-gradient(90deg, transparent, #f5bd31 18%, #ffe78c 50%, #f5bd31 82%, transparent);
    font-size: 36px;
    font-family: "Lilita One", "WOS Report", Loma, sans-serif;
    font-weight: 400;
    line-height: 1.05;
    -webkit-text-stroke: 1.8px #735a3f;
    paint-order: stroke fill;
    text-shadow: 0 3px 0 #735a3f;
  }

  .synthetic-identity {
    z-index: 2;
    display: flex;
    align-items: center;
    flex-direction: column;
    padding-top: 27px;
  }

  .synthetic-avatar {
    width: 112px;
    height: 112px;
    position: relative;
    overflow: visible;
    border: 6px solid white;
    border-radius: 20px;
    background: linear-gradient(#f7c05c, #d56b43);
    box-shadow: 0 4px 0 rgb(92 67 55 / 55%);
  }

  .synthetic-avatar img {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 13px;
    object-fit: cover;
    image-rendering: auto;
  }

  .synthetic-report--framed-avatars .synthetic-avatar {
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  .synthetic-report--framed-avatars .synthetic-avatar img {
    border-radius: 0;
    object-fit: contain;
  }

  .synthetic-report--framed-avatars .synthetic-role-icon,
  .synthetic-report--framed-avatars .synthetic-inspect-icon {
    display: none;
  }

  .synthetic-avatar > span:first-child:not(.synthetic-role-icon) {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    color: white;
    font-size: 58px;
  }

  .synthetic-role-icon {
    position: absolute;
    top: -14px;
    width: 34px;
    height: 34px;
    filter: drop-shadow(0 2px 0 #42545d);
  }

  .synthetic-avatar--attacker .synthetic-role-icon {
    left: -19px;
  }

  .synthetic-avatar--attacker .synthetic-role-icon::before,
  .synthetic-avatar--attacker .synthetic-role-icon::after {
    content: "";
    position: absolute;
    left: 14px;
    top: -2px;
    width: 7px;
    height: 38px;
    border: 2px solid #527087;
    border-radius: 5px 5px 2px 2px;
    background: white;
  }

  .synthetic-avatar--attacker .synthetic-role-icon::before { transform: rotate(45deg); }
  .synthetic-avatar--attacker .synthetic-role-icon::after { transform: rotate(-45deg); }

  .synthetic-avatar--defender .synthetic-role-icon {
    right: -18px;
    border: 4px solid white;
    border-radius: 7px 7px 12px 12px;
    background: #638295;
    clip-path: polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%);
    box-shadow: inset 0 0 0 3px #dff5ff;
  }

  .synthetic-inspect-icon {
    position: absolute;
    right: -17px;
    bottom: -12px;
    width: 36px;
    height: 36px;
    border: 5px solid white;
    border-radius: 50%;
    background: #2ba7f3;
    box-shadow: 0 2px 0 #3f748e;
  }

  .synthetic-inspect-icon::before {
    content: "";
    position: absolute;
    left: 9px;
    top: 8px;
    width: 8px;
    height: 8px;
    border: 3px solid white;
    border-radius: 50%;
  }

  .synthetic-inspect-icon::after {
    content: "";
    position: absolute;
    left: 20px;
    top: 20px;
    width: 9px;
    height: 4px;
    border-radius: 3px;
    background: white;
    transform: rotate(45deg);
    transform-origin: left center;
  }

  .synthetic-player-name,
  .synthetic-coordinates,
  .synthetic-power-change {
    position: relative;
    z-index: 2;
  }

  .synthetic-player-name {
    max-width: 300px;
    margin-top: 9px;
    overflow: hidden;
    color: white;
    font-size: 25px;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
    -webkit-text-stroke: 1.25px #70574b;
    paint-order: stroke fill;
    text-shadow: 0 2px 0 #70574b;
  }

  .synthetic-coordinates {
    color: #0f3c54;
    border-bottom: 3px solid #0f3c54;
    font-size: 22px;
    line-height: 1.2;
  }

  .synthetic-power-change {
    margin-top: 24px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #ff2d31;
    font-size: 27px;
    line-height: 1;
  }

  .synthetic-power-icon {
    font-family: "Noto Color Emoji", sans-serif;
    font-size: 29px;
    filter: hue-rotate(160deg) saturate(0.75);
  }

  .synthetic-outcomes {
    background: #f6e8dc;
  }

  .synthetic-outcome-row {
    height: 59px;
    display: grid;
    grid-template-columns: 1fr 1.15fr 1fr;
    place-items: center;
    background: rgb(255 250 245 / 65%);
    font-size: 26px;
    line-height: 1;
  }

  .synthetic-outcome-row:nth-child(even) {
    background: #f6e8dc;
  }

  .synthetic-outcome-row strong {
    font-weight: 700;
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 7px;
  }

  .synthetic-outcome-row--alert > span {
    color: #ff2026;
  }

  .synthetic-info-icon {
    width: 26px;
    height: 26px;
    margin-left: 7px;
    display: inline-grid;
    place-items: center;
    border: 3px solid #9b806c;
    border-radius: 9px;
    font-family: sans-serif;
    font-size: 17px;
    font-style: normal;
    line-height: 1;
    text-decoration: none;
    vertical-align: 1px;
  }

  .synthetic-next {
    width: 39px;
    height: 58px;
    position: absolute;
    z-index: 8;
    right: -4px;
    top: 335px;
    background: white;
    box-shadow: 0 3px 0 #4e8298;
    clip-path: polygon(0 0, 56% 0, 100% 50%, 56% 100%, 0 100%, 43% 50%);
  }

  .synthetic-next::after {
    content: "";
    position: absolute;
    inset: 4px;
    background: #9deeff;
    clip-path: inherit;
  }

  .synthetic-overview {
    position: relative;
  }
`;
