"use client";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import SearchIcon from "@mui/icons-material/Search";
import PrivacyToggle from "./PrivacyToggle";
import { iconButtonSx, type } from "@/lib/ui";

interface Props {
  title: string;
  /** Page-specific buttons. The page's main action goes last, as a primary button. */
  actions?: React.ReactNode;
  /** Shows the privacy toggle; pass whether the page has sensitive tasks. */
  privacy?: { sensitiveTasks?: boolean } | false;
  /** Click handler on the title, for pages that hang a gesture off it. */
  onTitleClick?: () => void;
}

/** The bar at the top of every page: title on the left, search, privacy and actions on the right. */
export default function PageHeader({ title, actions, privacy = { sensitiveTasks: false }, onTitleClick }: Props) {
  return (
    <Box sx={{
      height: 60, flexShrink: 0,
      px: { xs: 1.5, sm: 3 },
      display: "flex", alignItems: "center", gap: { xs: 0.75, sm: 1.25 },
      backgroundColor: "var(--surface)",
      borderBottom: "1px solid var(--border)",
    }}>
      <Typography component="h1" onClick={onTitleClick}
        sx={{ ...type.pageTitle, mr: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", userSelect: "none", cursor: "default" }}>
        {title}
      </Typography>
      <Tooltip title="Search everything  ⌘K" placement="bottom" arrow>
        <IconButton size="small" aria-label="Search" onClick={() => window.dispatchEvent(new CustomEvent("globalsearch:open"))} sx={iconButtonSx}>
          <SearchIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      {privacy && <PrivacyToggle sensitiveTasks={privacy.sensitiveTasks} />}
      {actions}
    </Box>
  );
}
