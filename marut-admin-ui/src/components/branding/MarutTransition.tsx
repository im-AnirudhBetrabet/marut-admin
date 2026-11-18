import { useEffect, useRef, useState } from "react";

type MarutTransitionProps = {
  mode: "login" | "logout";
  /** True only after Supabase and any required backend checks have succeeded. */
  ready: boolean;
  onComplete: () => void | Promise<void>;
};

type Phase = "typing" | "waiting" | "exit";

const particles = Array.from({ length: 12 }, (_, index) => index + 1);
const TYPE_DURATION_MS = 900;
const EXIT_DURATION_MS = 680;

export function MarutTransition({ mode, ready, onComplete }: MarutTransitionProps) {
  const [phase, setPhase] = useState<Phase>("typing");
  const onCompleteRef = useRef(onComplete);

  // Keep the latest callback without making the animation timer depend on
  // the identity of an inline callback supplied by the parent.
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Keep the typing phase visible for at least its full duration.
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => setPhase("waiting"),
      reducedMotion ? 80 : TYPE_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  // Once both the typing animation and the real auth operation are complete,
  // move into the exit phase. This effect does not own the exit timer.
  useEffect(() => {
    if (phase === "waiting" && ready) {
      setPhase("exit");
    }
  }, [phase, ready]);

  // Run the exit timer in its own effect. This prevents the phase change above
  // from immediately cleaning up and cancelling the navigation callback.
  useEffect(() => {
    if (phase !== "exit") return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => { void onCompleteRef.current(); },
      reducedMotion ? 80 : EXIT_DURATION_MS,
    );

    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <div
      className={`marut-transition marut-transition--${mode} marut-transition--${phase}`}
      role="status"
      aria-live="polite"
      aria-label={
        phase === "waiting"
          ? (mode === "login" ? "Verifying your MARUT workspace" : "Signing out securely")
          : (mode === "login" ? "Entering MARUT Admin" : "Signing out of MARUT Admin")
      }
      data-phase={phase}
    >
      <div className="marut-transition-glow" aria-hidden="true" />
      <div className="marut-transition-lockup" aria-hidden="true">
        <span className="marut-transition-word">MARUT</span>
        <span className="marut-transition-caret" />
        <span className="marut-transition-particles">
          {particles.map((particle) => (
            <span
              className={`marut-transition-particle marut-transition-particle--${particle}`}
              key={particle}
            />
          ))}
        </span>
      </div>
      <p className="marut-transition-caption">
        {phase === "typing"
          ? "Growing your workspace"
          : phase === "waiting"
            ? (mode === "login" ? "Preparing your workspace" : "Securing your session")
            : (mode === "login" ? "Welcome to MARUT" : "Until next time")}
      </p>
      <span className="marut-transition-rule" aria-hidden="true" />
    </div>
  );
}
