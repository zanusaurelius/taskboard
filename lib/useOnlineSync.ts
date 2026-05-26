"use client";
import { useEffect, useRef, useState } from "react";
import { getQueueLength } from "./offline-db";
import { flushWriteQueue } from "./sync";

export function useOnlineSync() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const flushingRef = useRef(false);

  useEffect(() => {
    const refresh = () => getQueueLength().then(setPendingCount).catch(() => {});
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onOnline = async () => {
      setIsOnline(true);
      if (flushingRef.current) return;
      const n = await getQueueLength().catch(() => 0);
      if (n === 0) return;
      flushingRef.current = true;
      setSyncing(true);
      try {
        await flushWriteQueue();
      } finally {
        flushingRef.current = false;
        setSyncing(false);
        getQueueLength().then(setPendingCount).catch(() => {});
      }
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return { isOnline, pendingCount, syncing };
}
