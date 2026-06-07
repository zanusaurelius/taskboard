import { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  surfaceHover: string;
  border: string;
  border2: string;
  cardBorder: string;
  tx: string;
  tx2: string;
  tx3: string;
  tx4: string;
  placeholder: string;
  tabBarBg: string;
  tabBarBorder: string;
  tabBarActive: string;
  tabBarInactive: string;
  statusBar: 'light' | 'dark';
}

const DARK: ThemeColors = {
  bg: '#0f172a',
  surface: '#1e293b',
  surface2: '#162032',
  surfaceHover: '#243347',
  border: '#334155',
  border2: '#475569',
  cardBorder: 'rgba(255,255,255,0.07)',
  tx: '#f1f5f9',
  tx2: '#94a3b8',
  tx3: '#64748b',
  tx4: '#475569',
  placeholder: '#475569',
  tabBarBg: '#0f172a',
  tabBarBorder: 'rgba(255,255,255,0.08)',
  tabBarActive: '#a5b4fc',
  tabBarInactive: 'rgba(255,255,255,0.45)',
  statusBar: 'light',
};

const LIGHT: ThemeColors = {
  bg: '#f1f5f9',
  surface: '#ffffff',
  surface2: '#f8fafc',
  surfaceHover: '#e2e8f0',
  border: '#e2e8f0',
  border2: '#cbd5e1',
  cardBorder: '#e2e8f0',
  tx: '#0f172a',
  tx2: '#475569',
  tx3: '#64748b',
  tx4: '#94a3b8',
  placeholder: '#94a3b8',
  tabBarBg: '#ffffff',
  tabBarBorder: '#e2e8f0',
  tabBarActive: '#6366f1',
  tabBarInactive: '#94a3b8',
  statusBar: 'dark',
};

const THEME_KEY = 'taskboard_theme_mode';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  colors: DARK,
  setMode: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
      setLoaded(true);
    });
  }, []);

  const setMode = async (m: ThemeMode) => {
    setModeState(m);
    await SecureStore.setItemAsync(THEME_KEY, m);
  };

  const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const colors = isDark ? DARK : LIGHT;

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={{ mode, colors, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
