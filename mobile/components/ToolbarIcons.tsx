import { View, Text } from 'react-native';

const C = '#94a3b8';

export function BulletListIcon() {
  return (
    <View style={{ gap: 2.5 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C }} />
          <View style={{ width: 13, height: 1.5, borderRadius: 1, backgroundColor: C }} />
        </View>
      ))}
    </View>
  );
}

export function NumberedListIcon() {
  return (
    <View style={{ gap: 2 }}>
      {([1, 2, 3] as const).map((n) => (
        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={{ color: C, fontSize: 7, fontWeight: '700', width: 8, lineHeight: 9 }}>{n}.</Text>
          <View style={{ width: 11, height: 1.5, borderRadius: 1, backgroundColor: C }} />
        </View>
      ))}
    </View>
  );
}

export function ImageUploadIcon() {
  return (
    <View style={{
      width: 20, height: 16,
      borderWidth: 1.5, borderColor: C, borderRadius: 2,
      overflow: 'hidden',
    }}>
      <View style={{
        position: 'absolute', top: 2, right: 3,
        width: 4, height: 4, borderRadius: 2, backgroundColor: C,
      }} />
      <View style={{
        position: 'absolute', bottom: 2, left: 1,
        width: 0, height: 0,
        borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 6,
        borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C,
      }} />
      <View style={{
        position: 'absolute', bottom: 2, right: 3,
        width: 0, height: 0,
        borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 5,
        borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: C,
      }} />
    </View>
  );
}
