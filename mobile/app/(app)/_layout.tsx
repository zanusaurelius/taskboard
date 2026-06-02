import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';

function TabIcon({ label, active }: { label: string; active: boolean }) {
  const icons: Record<string, string> = {
    Board: '📋',
    Notes: '📝',
    Journal: '📖',
    Files: '🗂️',
    Settings: '⚙️',
  };
  return (
    <View style={styles.iconWrap}>
      <Text style={[styles.icon, active && styles.iconActive]}>{icons[label]}</Text>
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export default function AppLayout() {
  return (
    <Tabs
      initialRouteName="board"
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
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
  tabBar: {
    backgroundColor: '#0f172a',
    borderTopColor: 'rgba(255,255,255,0.08)',
    height: 60,
  },
  iconWrap: {
    alignItems: 'center',
    gap: 2,
  },
  icon: {
    fontSize: 20,
    color: 'rgba(255,255,255,0.45)',
  },
  iconActive: {
    color: '#a5b4fc',
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: -0.2,
  },
  labelActive: {
    color: '#a5b4fc',
  },
});
