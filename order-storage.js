import { getPublicSupabase } from './supabase-public.js?v=1';

export async function saveWebsiteOrder(order) {
  try {
    const supabase = await getPublicSupabase();
    const { error } = await supabase.from('orders').insert(order)
      .abortSignal(AbortSignal.timeout(6000));
    if (error) throw error;
  } catch (error) {
    console.error('Не удалось сохранить заявку в Supabase.', error?.code || error?.name);
  }
}
