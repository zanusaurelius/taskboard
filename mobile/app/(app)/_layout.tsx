import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '@/lib/theme-context';
import { useVault } from '@/lib/vault-context';

function TabIcon({ label, active }: { label: string; active: boolean }) {
  const colors = useThemeColors();
  const icons: Record<string, string> = {
    Board: '📋',
    Notes: '📝',
    Journal: '📖',
    Files: '🗂️',
    Settings: '⚙️',
  };
  return (
    <View style={styles.iconWrap}>
      <Text style={styles.icon}>{icons[label]}</Text>
      <Text style={[styles.label, { color: active ? colors.tabBarActive : colors.tabBarInactive }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export default function AppLayout() {
  const colors = useThemeColors();
  const { lock } = useVault();
  return (
    <Tabs
      initialRouteName="board"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.tabBarBg,
          borderTopColor: colors.tabBarBorder,
          height: 60,
        },
        tabBarShowLabel: false,
      }}
      screenListeners={{
        tabPress: () => { lock(); },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen
        name="board"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Board" active={focused} />,
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Notes" active={focused} />,
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Journal" active={focused} />,
        }}
      />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen
        name="files"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Files" active={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Settings" active={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    gap: 2,
  },
  icon: {
    fontSize: 20,
  },
  label: {
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
});
