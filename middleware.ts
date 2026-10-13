import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Every page except /login, /rider-login and the lead webhook requires a signed-in user.
export async function middleware(req: NextRequest) {
  // The Google Form webhook has no browser session; it is protected by its own secret inside the route.
  if (req.nextUrl.pathname === '/api/leads') return NextResponse.next();
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  const onRiderLogin = path.startsWith('/rider-login');
  const onLogin = path.startsWith('/login');
  if (onRiderLogin) return data.user ? NextResponse.redirect(new URL('/rider', req.url)) : res;
  if (!data.user && path.startsWith('/rider')) return NextResponse.redirect(new URL('/rider-login', req.url));
  if (!data.user && !onLogin) return NextResponse.redirect(new URL('/login', req.url));
  if (data.user && onLogin) return NextResponse.redirect(new URL('/overview', req.url));
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|riderx-x.png).*)'] };
