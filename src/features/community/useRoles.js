import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';

// Everything the signed-in user is allowed to run: communities they admin,
// operators they staff, and whether they are a ForeSome platform admin.
export default function useRoles(session) {
  const [roles, setRoles] = useState({ platform_admin: false, organizations: [], communities: [], memberships: [] });
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!session?.user?.id) return;
    const { data, error } = await supabase.rpc('my_roles');
    if (error) { setMissing(/my_roles|does not exist|Could not find/i.test(error.message)); }
    else if (data) { setRoles(data); setMissing(false); }
    setReady(true);
  }, [session?.user?.id]);

  useEffect(() => { reload(); }, [reload]);

  return {
    ...roles,
    ready, missing, reload,
    isPlatformAdmin: !!roles.platform_admin,
    adminCommunities: roles.communities || [],
    staffOrgs: roles.organizations || [],
    memberOf: (cid) => (roles.memberships || []).find(m => m.community_id === cid)?.status || null,
  };
}
