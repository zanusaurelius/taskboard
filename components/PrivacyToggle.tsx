"use client";
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { usePrivacy } from "@/lib/privacy";
import { useVault } from "@/lib/vault-context";
import VaultUnlockModal from "./VaultUnlockModal";

interface Props {
  /** Sensitive tasks on the current page, besides private habits. */
  sensitiveTasks?: boolean;
}

/**
 * Header button for privacy mode. Revealing asks for the vault password when anything hidden
 * exists and a vault is set up; hiding again locks the vault.
 */
export default function PrivacyToggle({ sensitiveTasks = false }: Props) {
  const { on, setOn, privateHabits } = usePrivacy();
  const { isUnlocked, lockVault, hideVault } = useVault();
  const [vaultExists, setVaultExists] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  useEffect(() => {
    fetch("/api/notes/vault")
      .then((r) => r.json())
      .then((d) => {
        setVaultExists(!!d.exists);
        if (d.exists) {
          try {
            const creds = JSON.parse(d.webAuthnCredentials ?? "[]");
            setHasWebAuthn(Array.isArray(creds) && creds.length > 0);
          } catch { /* ignore */ }
        }
      })
      .catch(() => {});
  }, []);

  // When the vault locks (timer, page change), hide everything again.
  useEffect(() => {
    if (!isUnlocked && vaultExists) setOn(true);
  }, [isUnlocked, vaultExists, setOn]);

  const toggle = () => {
    if (on) {
      if (vaultExists && (sensitiveTasks || privateHabits > 0)) setUnlockOpen(true);
      else setOn(false);
    } else {
      lockVault();
      hideVault();
      setOn(true);
    }
  };

  return (
    <>
      <Tooltip title={on ? "Private items are hidden. Click to show them." : "Click to hide private items."} placement="bottom" arrow>
        <Button
          size="small"
          onClick={toggle}
          aria-pressed={on}
          startIcon={on ? <VisibilityOffOutlinedIcon sx={{ fontSize: "18px !important" }} /> : <VisibilityOutlinedIcon sx={{ fontSize: "18px !important" }} />}
          sx={{
            textTransform: "none", fontSize: "0.85rem", fontWeight: 600, borderRadius: 2,
            px: { xs: 1, sm: 1.5 }, minWidth: 0,
            border: "1px solid",
            borderColor: on ? "var(--accent-line)" : "var(--border-2)",
            backgroundColor: on ? "var(--accent-tint)" : "transparent",
            color: on ? "var(--accent-fg)" : "var(--tx-2)",
            "& .MuiButton-startIcon": { mr: { xs: 0, sm: 0.75 }, ml: 0 },
            "&:hover": { backgroundColor: on ? "var(--accent-tint)" : "var(--surface-2)", borderColor: on ? "var(--accent-line)" : "var(--tx-4)" },
          }}
        >
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{on ? "Private" : "Showing all"}</Box>
        </Button>
      </Tooltip>
      <VaultUnlockModal
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        onSuccess={() => { setUnlockOpen(false); setOn(false); }}
        mode="unlock"
        hasWebAuthn={hasWebAuthn}
      />
    </>
  );
}
