import React, {useState, useEffect} from 'react';
import {View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, StyleSheet} from 'react-native';
import {useForm, Controller} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Picker} from '@react-native-picker/picker';
import {Button, Input} from '../../components/ui';
import {authService} from '../../services/authService';
import {useAuthStore} from '../../store/authStore';
import {apiRequest} from '../../services/apiClient';
import type {AuthStackParamList} from '../../navigation/AuthNavigator';

const registerSchema = z.object({
  callsign: z.string().min(3, 'Callsign must be at least 3 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
  fullName: z.string().min(3, 'Full name must be at least 3 characters'),
  nrp: z.string().min(5, 'NRP/ID must be at least 5 characters'),
  rank: z.string().min(1, 'Rank is required'),
  branch: z.string().min(1, 'Branch is required'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type RegisterForm = z.infer<typeof registerSchema>;

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

interface Branch {
  id: number;
  branchName: string;
  code: string;
}

interface Rank {
  id: number;
  rankName: string;
  level: number;
  isOfficer: boolean;
  branch: string;
}

export function RegisterScreen({navigation}: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [loadingRanks, setLoadingRanks] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState('');
  const {setUser, setSessionToken} = useAuthStore();

  const {
    control,
    handleSubmit,
    formState: {errors},
    watch,
    setValue,
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      callsign: '',
      password: '',
      confirmPassword: '',
      fullName: '',
      nrp: '',
      rank: '',
      branch: '',
    },
  });

  // Watch branch field to fetch ranks when it changes
  const watchBranch = watch('branch');

  // Fetch branches on mount
  useEffect(() => {
    fetchBranches();
  }, []);

  // Fetch ranks when branch changes
  useEffect(() => {
    if (watchBranch && watchBranch !== selectedBranch) {
      setSelectedBranch(watchBranch);
      setValue('rank', ''); // Reset rank when branch changes
      fetchRanks(watchBranch);
    }
  }, [watchBranch]);

  const fetchBranches = async () => {
    try {
      setLoadingBranches(true);
      const data = await apiRequest<Branch[]>('/api/public/branches');
      console.log('[Register] Branches loaded:', data);
      setBranches(data);
    } catch (error) {
      console.error('[Register] Failed to fetch branches:', error);
      Alert.alert('Error', 'Failed to load branches. Please check your connection.');
    } finally {
      setLoadingBranches(false);
    }
  };

  const fetchRanks = async (branch: string) => {
    try {
      setLoadingRanks(true);
      const data = await apiRequest<Rank[]>(`/api/public/ranks?branch=${branch}`);
      console.log('[Register] Ranks loaded:', data);
      setRanks(data);
    } catch (error) {
      console.error('[Register] Failed to fetch ranks:', error);
      Alert.alert('Error', 'Failed to load ranks for selected branch.');
      setRanks([]);
    } finally {
      setLoadingRanks(false);
    }
  };

  const onSubmit = async (data: RegisterForm) => {
    try {
      setIsLoading(true);
      const {confirmPassword, ...registerData} = data;

      console.log('[Register] Attempting registration for:', registerData.callsign);
      console.log('[Register] Registration data:', registerData);
      const response = await authService.register(registerData);

      // Update auth store
      setUser(response.user);
      await setSessionToken(response.sessionToken);

      console.log('[Register] Success:', response.user.callsign);

      // Connect to WebSocket now that we're authenticated (pass user ID directly)
      const {websocketService} = await import('../../services/websocket');
      websocketService.connect(response.user.id).catch((error) => {
        console.error('[Register] WebSocket connection error:', error);
      });
      console.log('[Register] WebSocket connection initiated with userId:', response.user.id);

      Alert.alert(
        'Registration Successful',
        `Welcome, ${response.user.callsign}!`,
        [{text: 'OK'}]
      );
    } catch (error) {
      console.error('[Register] Error:', error);

      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('[Register] Error message:', errorMessage);

      // Parse common error messages for better UX
      let userFriendlyMessage = errorMessage;
      let suggestions: string[] = [];

      if (errorMessage.includes('already taken') || errorMessage.includes('already exists')) {
        suggestions.push('Try a different callsign');
      } else if (errorMessage.includes('NRP') || errorMessage.includes('already registered')) {
        suggestions.push('This NRP/ID is already registered');
        suggestions.push('Contact admin if this is your ID');
      } else if (errorMessage.includes('Network') || errorMessage.includes('fetch')) {
        suggestions.push('Check your internet connection');
        suggestions.push('Verify server is running at 31.97.50.227:5000');
      }

      Alert.alert(
        'Registration Failed',
        errorMessage + (suggestions.length > 0 ? '\n\nSuggestions:\n• ' + suggestions.join('\n• ') : ''),
        [{text: 'OK'}]
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
          <View style={styles.innerContainer}>
            <View style={styles.header}>
              <Text style={styles.title}>
                PERSONNEL REGISTRATION
              </Text>
              <Text style={styles.subtitle}>
                SECURE MILITARY COMMUNICATION SYSTEM
              </Text>
              <View style={styles.divider} />
            </View>

            <View style={styles.formContainer}>
              <Controller
                control={control}
                name="callsign"
                render={({field: {onChange, onBlur, value}}) => (
                  <View style={styles.fieldContainer}>
                    <Text style={styles.label}>CALLSIGN / USERNAME</Text>
                    <Input
                      placeholder="ENTER CALLSIGN"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.callsign?.message}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />
                    {errors.callsign && (
                      <Text style={styles.errorText}>{errors.callsign.message}</Text>
                    )}
                  </View>
                )}
              />

              <Controller
                control={control}
                name="nrp"
                render={({field: {onChange, onBlur, value}}) => (
                  <View style={styles.fieldContainer}>
                    <Text style={styles.label}>NRP / PERSONNEL ID</Text>
                    <Input
                      placeholder="ENTER NRP"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.nrp?.message}
                      keyboardType="numeric"
                    />
                    {errors.nrp && (
                      <Text style={styles.errorText}>{errors.nrp.message}</Text>
                    )}
                  </View>
                )}
              />

              <Controller
                control={control}
                name="fullName"
                render={({field: {onChange, onBlur, value}}) => (
                  <View style={styles.fieldContainer}>
                    <Text style={styles.label}>FULL NAME</Text>
                    <Input
                      placeholder="ENTER FULL NAME"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.fullName?.message}
                    />
                    {errors.fullName && (
                      <Text style={styles.errorText}>{errors.fullName.message}</Text>
                    )}
                  </View>
                )}
              />

              <View style={styles.fieldContainer}>
                <Text style={styles.label}>BRANCH / UNIT</Text>
                {loadingBranches ? (
                  <View style={styles.pickerContainer}>
                    <ActivityIndicator size="small" color="#a6c455" />
                  </View>
                ) : (
                  <Controller
                    control={control}
                    name="branch"
                    render={({field: {onChange, value}}) => (
                      <View style={styles.pickerContainer}>
                        <Picker
                          selectedValue={value}
                          onValueChange={onChange}
                          style={styles.picker}
                          dropdownIconColor="#a6c455">
                          <Picker.Item label="SELECT BRANCH" value="" style={styles.pickerItem} />
                          {branches.map((branch) => (
                            <Picker.Item
                              key={branch.id}
                              label={branch.branchName}
                              value={branch.branchName}
                              style={styles.pickerItem}
                            />
                          ))}
                        </Picker>
                      </View>
                    )}
                  />
                )}
                {errors.branch && (
                  <Text style={styles.errorText}>{errors.branch.message}</Text>
                )}
              </View>

              <View style={styles.fieldContainer}>
                <Text style={styles.label}>RANK</Text>
                {loadingRanks ? (
                  <View style={styles.pickerContainer}>
                    <ActivityIndicator size="small" color="#a6c455" />
                  </View>
                ) : (
                  <Controller
                    control={control}
                    name="rank"
                    render={({field: {onChange, value}}) => (
                      <View style={[styles.pickerContainer, !watchBranch && styles.pickerDisabled]}>
                        <Picker
                          selectedValue={value}
                          onValueChange={onChange}
                          enabled={!!watchBranch && ranks.length > 0}
                          style={styles.picker}
                          dropdownIconColor={watchBranch ? "#a6c455" : "#666"}>
                          <Picker.Item
                            label={!watchBranch ? 'SELECT BRANCH FIRST' : 'SELECT RANK'}
                            value=""
                            style={styles.pickerItem}
                          />
                          {ranks.map((rank) => (
                            <Picker.Item
                              key={rank.id}
                              label={rank.rankName}
                              value={rank.rankName}
                              style={styles.pickerItem}
                            />
                          ))}
                        </Picker>
                      </View>
                    )}
                  />
                )}
                {errors.rank && (
                  <Text style={styles.errorText}>{errors.rank.message}</Text>
                )}
              </View>

              <Controller
                control={control}
                name="password"
                render={({field: {onChange, onBlur, value}}) => (
                  <View style={styles.fieldContainer}>
                    <Text style={styles.label}>SECURITY CODE / PASSWORD</Text>
                    <Input
                      placeholder="ENTER SECURITY CODE"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.password?.message}
                      secureTextEntry
                      autoCapitalize="none"
                    />
                    {errors.password && (
                      <Text style={styles.errorText}>{errors.password.message}</Text>
                    )}
                  </View>
                )}
              />

              <Controller
                control={control}
                name="confirmPassword"
                render={({field: {onChange, onBlur, value}}) => (
                  <View style={styles.fieldContainer}>
                    <Text style={styles.label}>CONFIRM SECURITY CODE</Text>
                    <Input
                      placeholder="CONFIRM SECURITY CODE"
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={errors.confirmPassword?.message}
                      secureTextEntry
                      autoCapitalize="none"
                    />
                    {errors.confirmPassword && (
                      <Text style={styles.errorText}>{errors.confirmPassword.message}</Text>
                    )}
                  </View>
                )}
              />

              <Text style={styles.disclaimer}>
                BY REGISTERING, YOU ACCEPT ALL MILITARY COMMUNICATION PROTOCOLS
              </Text>

              <View style={styles.buttonContainer}>
                <Button
                  title="REGISTER PERSONNEL"
                  onPress={handleSubmit(onSubmit)}
                  isLoading={isLoading}
                />
              </View>

              <View style={styles.buttonContainer}>
                <Button
                  title="BACK TO LOGIN"
                  variant="outline"
                  onPress={() => navigation.goBack()}
                  disabled={isLoading}
                />
              </View>
            </View>
          </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#171717',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  innerContainer: {
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#a6c455',
    textAlign: 'center',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  divider: {
    height: 2,
    backgroundColor: '#4d5d30',
    width: 60,
    marginTop: 12,
  },
  formContainer: {
    gap: 20,
  },
  fieldContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  pickerContainer: {
    backgroundColor: '#222',
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  pickerDisabled: {
    opacity: 0.5,
    backgroundColor: '#1a1a1a',
  },
  picker: {
    color: '#fff',
    height: 50,
  },
  pickerItem: {
    backgroundColor: '#222',
    color: '#fff',
  },
  errorText: {
    color: '#ff4444',
    fontSize: 11,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  disclaimer: {
    fontSize: 10,
    color: '#666',
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  buttonContainer: {
    marginTop: 12,
  },
});
