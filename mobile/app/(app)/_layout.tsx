import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';

function TabIcon({ label, active }: { label: string; active: boolean }) {
  const icons: Record<string, string> = {
    Notes: '📝',
    Board: '📋',
    Journal: '📖',
    Settings: '⚙️',
  };
  return (
    <View style={styles.iconWrap}>
      <Text style={styles.icon}>{icons[label]}</Text>
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </View>
  );
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Notes" active={focused} />,
        }}
      />
      <Tabs.Screen
        name="board"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Board" active={focused} />,
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Journal" active={focused} />,
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
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  labelActive: {
    color: '#a5b4fc',
  },
});
