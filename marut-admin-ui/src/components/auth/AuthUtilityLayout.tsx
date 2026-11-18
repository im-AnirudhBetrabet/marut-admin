import type { ReactNode } from "react";

export function AuthUtilityLayout({ children }: { children: ReactNode }) {
    const brand = (
        <div className="auth-utility-brand">
            <img className="auth-logo" src="/assets/marut-logo-gold.png" alt="MARUT" />
            <p className="auth-subtitle">Admin Portal</p>
        </div>
    );

    return (
        <main className="auth-page auth-page--utility">
            <section className="auth-desktop-card" aria-label="MARUT Admin account recovery">
                <div className="auth-visual">
                    <img src="/assets/greenhouse-microgreens.webp" alt="Microgreens growing in trays beside a hydroponic greenhouse" />
                </div>
                <div className="auth-form-panel auth-utility-panel">
                    {brand}
                    <div className="auth-utility-content">{children}</div>
                    <img className="auth-wave" src="/assets/botanical-wave.webp" alt="" aria-hidden="true" />
                </div>
            </section>

            <section className="auth-mobile-card auth-utility-mobile" aria-label="MARUT Admin account recovery">
                <div className="auth-mobile-illustration">
                    <img src="/assets/greenhouse-microgreens.webp" alt="Microgreens growing in trays beside a hydroponic greenhouse" />
                </div>
                <div className="auth-utility-mobile-panel">
                    {brand}
                    <div className="auth-utility-content">{children}</div>
                    <img className="auth-wave auth-wave--mobile" src="/assets/botanical-wave.webp" alt="" aria-hidden="true" />
                </div>
            </section>
        </main>
    );
}
