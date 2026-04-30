export const MAX_USERNAME_LEN     = 50;
export const MAX_PASSWORD_LEN     = 1024; // bcrypt ignores beyond 72 bytes but pre-processing is O(n)
export const MAX_PROJECT_NAME_LEN = 200;
export const MAX_FOLDER_NAME_LEN  = 200;
export const MAX_TASK_TITLE_LEN   = 500;
export const MAX_TASK_DESC_LEN    = 500_000;   // 500 KB
export const MAX_NOTE_TITLE_LEN   = 500;
export const MAX_NOTE_CONTENT_LEN = 1_000_000; // 1 MB (HTML with embedded image refs can be large)
