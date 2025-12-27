import React from 'react';
import {View, Text, StyleSheet} from 'react-native';

export function LapsitScreen() {
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SITUATION REPORTS</Text>
        <View style={styles.headerDivider} />
      </View>

      {/* Empty State */}
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconBox}>
          <Text style={styles.emptyIcon}>📊</Text>
        </View>
        <Text style={styles.emptyTitle}>NO ACTIVE REPORTS</Text>
        <Text style={styles.emptySubtitle}>
          SITUATIONAL AWARENESS DATA UNAVAILABLE
        </Text>
        <View style={styles.emptyDivider} />
        <Text style={styles.emptyHint}>
          LAPSIT UPDATES WILL APPEAR HERE
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
  },
  header: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#4d5d30',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 2,
    textAlign: 'center',
  },
  headerDivider: {
    height: 2,
    backgroundColor: '#4d5d30',
    width: 100,
    alignSelf: 'center',
    marginTop: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconBox: {
    width: 100,
    height: 100,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#4d5d30',
    marginBottom: 24,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#a6c455',
    letterSpacing: 2,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 11,
    color: '#666',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyDivider: {
    height: 2,
    backgroundColor: '#4d5d30',
    width: 60,
    marginBottom: 16,
  },
  emptyHint: {
    fontSize: 10,
    color: '#888',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
