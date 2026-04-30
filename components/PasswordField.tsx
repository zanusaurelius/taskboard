"use client";
import { useState } from "react";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";

type Props = Omit<TextFieldProps, "type"> & { fieldSx?: object };

export default function PasswordField({ fieldSx = {}, ...props }: Props) {
  const [show, setShow] = useState(false);

  return (
    <TextField
      {...props}
      type={show ? "text" : "password"}
      sx={fieldSx}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                size="small"
                onClick={() => setShow((v) => !v)}
                onMouseDown={(e) => e.preventDefault()}
                edge="end"
                tabIndex={-1}
                sx={{ color: "#94a3b8", "&:hover": { color: "#475569" } }}
              >
                {show ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
