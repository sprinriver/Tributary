import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiResponse, type ApiQuery } from '../api.ts';

export const usePrograms = () => useQuery({ queryKey: ['programs'], queryFn: () => api('listPrograms') });

export const useExperiments = (
  query: ApiQuery<'listExperiments'>,
  poll?: (data: ApiResponse<'listExperiments'> | undefined) => number | false,
) =>
  useQuery({
    queryKey: ['experiments', query],
    queryFn: () => api('listExperiments', { query }),
    placeholderData: (prev) => prev,
    ...(poll
      ? {
          refetchInterval: (q: { state: { data: ApiResponse<'listExperiments'> | undefined } }) =>
            poll(q.state.data),
        }
      : {}),
  });

export const useExperiment = (id: string) =>
  useQuery({ queryKey: ['experiment', id], queryFn: () => api('getExperiment', { params: { id } }) });

export const useVersion = (id: string | undefined) =>
  useQuery({
    queryKey: ['version', id],
    queryFn: () => api('getVersion', { params: { id: id! } }),
    enabled: !!id,
  });

export const useSamples = (id: string | undefined) =>
  useQuery({
    queryKey: ['samples', id],
    queryFn: () => api('listSamples', { params: { id: id! } }),
    enabled: !!id,
  });

export const useDiff = (from: string | undefined, to: string | undefined) =>
  useQuery({
    queryKey: ['diff', from, to],
    queryFn: () => api('diffVersions', { params: { id: from!, otherId: to! } }),
    enabled: !!from && !!to && from !== to,
  });

/** Invalidates everything that shows registry data after a change. */
export function useRegistryInvalidation() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ['experiments', 'experiment', 'version', 'samples', 'diff'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useCloneVersion() {
  const invalidate = useRegistryInvalidation();
  return useMutation({
    mutationFn: (versionId: string) =>
      api('cloneVersion', { params: { id: versionId }, reason: 'Create version' }),
    onSuccess: () => invalidate(),
  });
}
