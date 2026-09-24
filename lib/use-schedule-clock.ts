"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ClockAnchor = { epochMs: number; monotonicMs: number };

export function useScheduleClock() {
  const anchor = useRef<ClockAnchor | null>(null);
  const [now, setNow] = useState(() => new Date(0));
  const [initialized, setInitialized] = useState(false);
  const [wakeVersion, setWakeVersion] = useState(0);

  const currentTime = useCallback(() => {
    const currentAnchor = anchor.current;
    if (!currentAnchor) return new Date();
    return new Date(currentAnchor.epochMs + performance.now() - currentAnchor.monotonicMs);
  }, []);

  const calibrate = useCallback((serverTime: unknown) => {
    if (typeof serverTime !== "string") return;
    const epochMs = Date.parse(serverTime);
    if (!Number.isFinite(epochMs)) return;
    anchor.current = { epochMs, monotonicMs: performance.now() };
    setNow(new Date(epochMs));
    setInitialized(true);
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      if (!anchor.current) anchor.current = { epochMs: Date.now(), monotonicMs: performance.now() };
      setNow(currentTime());
      setInitialized(true);
    }, 0);

    const update = () => setNow(currentTime());
    const refreshOnWake = () => {
      if (document.visibilityState !== "visible") return;
      if (!anchor.current) anchor.current = { epochMs: Date.now(), monotonicMs: performance.now() };
      update();
      setInitialized(true);
      setWakeVersion((value) => value + 1);
    };
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", refreshOnWake);
    document.addEventListener("visibilitychange", refreshOnWake);
    return () => {
      window.clearTimeout(initialize);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnWake);
      document.removeEventListener("visibilitychange", refreshOnWake);
    };
  }, [currentTime]);

  return { now, initialized, wakeVersion, calibrate };
}
