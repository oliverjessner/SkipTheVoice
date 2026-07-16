export interface ApplicationContext { userId: string; tenantId?: string }

export function requireContext(context: ApplicationContext | undefined): ApplicationContext {
  if (!context?.userId) throw new Error("An authenticated user context is required.");
  return context;
}
