import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBootstrap, fetchAutofillProposals, fetchCaptchaProposals, fetchExamStats, fetchUserscripts, queryKeys } from '../../api/queries';

export function useAdminData(showToast) {
  const [rememberedKeys, setRememberedKeys] = useState({});

  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: fetchBootstrap,
    staleTime: 30_000,
  });

  const autofill = useQuery({
    queryKey: queryKeys.autofillProposals,
    queryFn: fetchAutofillProposals,
    staleTime: 30_000,
  });

  const captcha = useQuery({
    queryKey: queryKeys.captchaProposals,
    queryFn: fetchCaptchaProposals,
    staleTime: 30_000,
  });

  const exam = useQuery({
    queryKey: queryKeys.examStats,
    queryFn: fetchExamStats,
    staleTime: 30_000,
  });

  const userscriptsQuery = useQuery({
    queryKey: queryKeys.userscripts,
    queryFn: fetchUserscripts,
    staleTime: 30_000,
  });

  const loading = bootstrap.isLoading || autofill.isLoading || captcha.isLoading || exam.isLoading || userscriptsQuery.isLoading;
  const error = bootstrap.error;

  if (error) {
    console.error("Bootstrap fetch failed", error);
  }

  const data = bootstrap.data || {};

  return {
    stats: data.usage || {},
    apiKeys: data.api_keys || [],
    access: {
      global_access: !!data.global_access,
      allowed_domains: data.allowed_domains || [],
    },
    models: data.model_registry || [],
    mappings: data.field_mappings || [],
    failedPayloads: data.datasets_files || [],
    datasetsDir: data.datasets_dir || '',
    cloudBackupConfigured: Boolean(data.cloud_backup_configured),
    masterKeyInfo: data.master_key_info || null,
    autofillProposals: autofill.data || [],
    captchaProposals: captcha.data || [],
    examStats: exam.data || { total_exam_solves: 0, exam_ok_count: 0, exam_ok_rate: 0 },
    userscripts: userscriptsQuery.data || [],
    loading,
    refresh: () => {
      bootstrap.refetch();
      autofill.refetch();
      captcha.refetch();
      exam.refetch();
      userscriptsQuery.refetch();
    },
    rememberedKeys,
    setRememberedKeys,
  };
}