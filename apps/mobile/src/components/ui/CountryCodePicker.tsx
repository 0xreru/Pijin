import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import countriesData from '../../constants/countries.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CountryEntry {
  isoCode: string;
  name: string;
  dialCode: string;
  flag: string;
  /** Number of subscriber digits. Can be an array for countries with variable lengths. */
  digitLength: number | number[];
  /** Maximum allowed input length for the TextInput `maxLength` prop. */
  maxDigits: number;
  /** Placeholder string for the local subscriber number input. */
  placeholder: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COUNTRIES: CountryEntry[] = countriesData as CountryEntry[];
const ASYNC_STORAGE_KEY = 'pijin:country';
export const DEFAULT_COUNTRY: CountryEntry = COUNTRIES.find((c) => c.isoCode === 'PH')!;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CountryCodePickerProps {
  value: CountryEntry;
  onChange: (country: CountryEntry) => void;
  /** Background color of the picker button. Defaults to '#F3F4F6'. */
  backgroundColor?: string;
  /** Text color. Defaults to '#08090A'. */
  textColor?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CountryCodePicker({
  value,
  onChange,
  backgroundColor = '#F3F4F6',
  textColor = '#08090A',
}: CountryCodePickerProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.dialCode.includes(query) ||
          c.isoCode.toLowerCase().includes(query.toLowerCase())
      )
    : COUNTRIES;

  const handleSelect = useCallback(
    async (country: CountryEntry) => {
      setModalVisible(false);
      setQuery('');
      onChange(country);
      try {
        await AsyncStorage.setItem(ASYNC_STORAGE_KEY, JSON.stringify(country));
      } catch {
        // non-fatal — in-memory state is still correct
      }
    },
    [onChange]
  );

  const renderItem = useCallback(
    ({ item }: { item: CountryEntry }) => (
      <TouchableOpacity
        style={[styles.listItem, item.isoCode === value.isoCode && styles.listItemSelected]}
        onPress={() => handleSelect(item)}
        activeOpacity={0.7}
      >
        <Text style={styles.flag}>{item.flag}</Text>
        <View style={styles.listItemText}>
          <Text style={styles.countryName}>{item.name}</Text>
          <Text style={styles.dialCodeSmall}>{item.dialCode}</Text>
        </View>
        {item.isoCode === value.isoCode && (
          <Ionicons name="checkmark-circle" size={20} color="#031634" />
        )}
      </TouchableOpacity>
    ),
    [value.isoCode, handleSelect]
  );

  return (
    <>
      {/* Picker trigger button */}
      <TouchableOpacity
        style={[styles.trigger, { backgroundColor }]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.75}
        accessibilityLabel={`Country code picker, currently ${value.name} ${value.dialCode}`}
        accessibilityRole="button"
      >
        <Text style={styles.flagText}>{value.flag}</Text>
        <Text style={[styles.dialCodeText, { color: textColor }]}>{value.dialCode}</Text>
        <Ionicons name="caret-down" size={12} color={textColor} style={styles.caret} />
      </TouchableOpacity>

      {/* Picker modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setModalVisible(false);
          setQuery('');
        }}
      >
        <SafeAreaView style={styles.modalContainer}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Country</Text>
            <TouchableOpacity
              onPress={() => {
                setModalVisible(false);
                setQuery('');
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color="#031634" />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color="#6B7280" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search country or dial code..."
              placeholderTextColor="#9CA3AF"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>

          {/* Country list */}
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.isoCode}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Async helpers (for preloading persisted country on app start)
// ---------------------------------------------------------------------------

/**
 * Loads the previously persisted country from AsyncStorage.
 * Returns `DEFAULT_COUNTRY` if nothing is stored or on error.
 */
export async function loadPersistedCountry(): Promise<CountryEntry> {
  try {
    const stored = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
    if (stored) {
      const parsed: CountryEntry = JSON.parse(stored);
      // Validate the stored entry still exists in our list
      const match = COUNTRIES.find((c) => c.isoCode === parsed.isoCode);
      if (match) return match;
    }
  } catch {
    // ignore
  }
  return DEFAULT_COUNTRY;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 4,
  },
  flagText: {
    fontSize: 18,
    lineHeight: 22,
  },
  dialCodeText: {
    fontSize: 15,
    fontWeight: '600',
  },
  caret: {
    marginLeft: 2,
  },
  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#031634',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },
  listContent: {
    paddingBottom: 32,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
    gap: 12,
  },
  listItemSelected: {
    backgroundColor: '#F0F4FF',
  },
  flag: {
    fontSize: 24,
    width: 32,
    textAlign: 'center',
  },
  listItemText: {
    flex: 1,
  },
  countryName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  dialCodeSmall: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 1,
  },
  separator: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginHorizontal: 20,
  },
});
