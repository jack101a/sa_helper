import { apiGet } from './client';

export const queryKeys = {
  bootstrap: ['bootstrap'],
  autofillProposals: ['autofillProposals'],
  captchaProposals: ['captchaProposals'],
  examStats: ['examStats'],
  trainingStats: ['trainingStats'],
  userscripts: ['userscripts'],
};

export async function fetchBootstrap() {
  return apiGet('/admin/api/bootstrap');
}

export async function fetchAutofillProposals() {
  return apiGet('/admin/api/autofill/proposals?status=all');
}

export async function fetchCaptchaProposals() {
  return apiGet('/admin/api/captcha/proposals?status=all');
}

export async function fetchExamStats() {
  return apiGet('/admin/api/exam/stats');
}

export async function fetchTrainingStats() {
  return apiGet('/admin/api/exam/training-stats');
}

export async function fetchUserscripts() {
  const data = await apiGet('/admin/api/userscripts');
  return data.scripts || [];
}
