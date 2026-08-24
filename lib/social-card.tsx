import { ImageResponse } from "next/og";

export const socialImageAlt = "Bidstage — open-source projects, ranked in public";
export const socialImageSize = { width: 1200, height: 630 };

export function socialImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#f1efe9",
        color: "#171714",
        fontFamily: "Arial, Helvetica, sans-serif",
        padding: "54px",
      }}
    >
      <div style={{ width: "100%", display: "flex", flexDirection: "column", border: "3px solid #171714" }}>
        <div
          style={{
            height: "74px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            borderBottom: "2px solid #171714",
            fontSize: "23px",
            fontWeight: 800,
          }}
        >
          <span>Bidstage</span>
          <span style={{ color: "#ff5b3d", fontSize: "17px", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Public ledger
          </span>
        </div>
        <div style={{ flex: 1, display: "flex" }}>
          <div style={{ width: "335px", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "2px solid #171714" }}>
            <div style={{ position: "absolute", width: "218px", height: "218px", borderRadius: "50% 50% 50% 18%", background: "#00ffcc", transform: "translate(13px, 13px)" }} />
            <div style={{ width: "218px", height: "218px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50% 50% 50% 18%", background: "#171714", color: "#fbfaf6", fontFamily: "Georgia, Times New Roman, serif", fontSize: "142px", lineHeight: 1 }}>
              B
            </div>
            <div style={{ position: "absolute", width: "62px", height: "18px", top: "52px", right: "32px", background: "#ff5b3d", transform: "rotate(4deg)" }} />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "48px 46px 38px" }}>
            <div style={{ maxWidth: "700px", fontFamily: "Georgia, Times New Roman, serif", fontSize: "69px", lineHeight: 0.96, letterSpacing: "-0.055em" }}>
              Open-source projects, ranked in public.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "19px" }}>
              <span style={{ background: "#e8e0c0", border: "2px solid #171714", padding: "10px 13px", transform: "rotate(-1deg)" }}>Owner verified</span>
              <span>Transparent placements</span>
              <span>Contributor opportunities</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    socialImageSize,
  );
}
