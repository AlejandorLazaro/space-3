'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client'; // your browser client

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.exchangeCodeForSession(window.location.href).then(() => {
      router.replace('/'); // or wherever you want to land post-login
    });
  }, [router]);

  return <p>Signing you in…</p>;
}