'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { BookSparkMark } from '@/components/icons';
import {
  Sparkles,
  UserPlus,
  Wand2,
  BookOpenCheck,
  Camera,
  Volume2,
  Printer,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';

/**
 * Public welcome / landing page shown at `/` to visitors who are not signed in.
 * It describes the product and routes prospects to sign-up (or sign-in).
 * Signed-in users never see this — the root page renders the app instead.
 */
export function WelcomeLanding() {
  return (
    <div className="flex flex-col">
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        {/* Soft brand wash behind the hero */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-primary/15 via-accent/10 to-background"
        />
        <div className="container mx-auto px-4 py-16 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="text-center lg:text-left">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
                <Sparkles className="h-4 w-4" />
                Personalised storybooks for kids
              </span>
              <h1 className="mt-6 font-headline text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
                Stories where your child is the{' '}
                <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  hero
                </span>
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground lg:mx-0">
                StoryPic Kids turns a few photos into beautifully illustrated,
                personalised storybooks starring your own child — ready to read
                together on screen or in print.
              </p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Button asChild size="lg" className="w-full px-8 sm:w-auto">
                  <Link href="/signup">Create your first story</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full px-8 sm:w-auto">
                  <Link href="/login">Sign in</Link>
                </Button>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Free to start · No credit card needed
              </p>
            </div>

            {/* Hero mark */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div
                  aria-hidden
                  className="absolute inset-0 -z-10 scale-110 rounded-[2.5rem] bg-gradient-to-br from-primary/30 to-accent/30 blur-2xl"
                />
                <div className="flex h-56 w-56 items-center justify-center rounded-[2.5rem] bg-gradient-to-br from-primary to-accent text-white shadow-xl sm:h-72 sm:w-72">
                  <BookSparkMark className="h-28 w-28 sm:h-36 sm:w-36" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-headline text-3xl font-bold sm:text-4xl">How it works</h2>
          <p className="mt-3 text-muted-foreground">
            Three simple steps to a storybook they will ask for again and again.
          </p>
        </div>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {[
            {
              icon: UserPlus,
              step: '1',
              title: 'Add your child',
              body: 'Create a profile and upload a few photos. We build a friendly illustrated likeness — your photos stay private.',
            },
            {
              icon: Wand2,
              step: '2',
              title: 'Pick a story',
              body: 'Choose an adventure, a bedtime tale or a lesson to learn. Your child is written in as the star.',
            },
            {
              icon: BookOpenCheck,
              step: '3',
              title: 'Read together',
              body: 'Get a fully illustrated storybook in minutes — read it on any device, listen along, or order it in print.',
            },
          ].map(({ icon: Icon, step, title, body }) => (
            <div
              key={step}
              className="relative rounded-2xl border border-border bg-card p-6 text-center shadow-sm"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-white shadow-sm">
                <Icon className="h-7 w-7" />
              </div>
              <div className="mt-4 text-sm font-semibold uppercase tracking-wide text-primary">
                Step {step}
              </div>
              <h3 className="mt-1 text-xl font-bold">{title}</h3>
              <p className="mt-2 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section className="bg-secondary/40 py-16">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-headline text-3xl font-bold sm:text-4xl">
              Made for little readers
            </h2>
            <p className="mt-3 text-muted-foreground">
              Everything you need to make reading personal, playful and safe.
            </p>
          </div>
          <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Camera,
                title: 'Starring your child',
                body: 'A consistent, lovable character drawn from your own photos appears on every page.',
              },
              {
                icon: Sparkles,
                title: 'Rich illustrations',
                body: 'Each page is freshly illustrated to match the story — colourful, warm and age-appropriate.',
              },
              {
                icon: Volume2,
                title: 'Read-aloud narration',
                body: 'Tap to listen. Gentle narration helps early readers follow along word by word.',
              },
              {
                icon: Printer,
                title: 'Keepsake in print',
                body: 'Love a story? Order a printed hardback to keep on the shelf and read at bedtime.',
              },
              {
                icon: ShieldCheck,
                title: 'Safe by design',
                body: 'A parent area with a PIN keeps settings and purchases in your hands, not little ones.',
              },
              {
                icon: Smartphone,
                title: 'On every device',
                body: 'Works in any browser and installs as an app on phones and tablets for offline reading.',
              },
            ].map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Closing CTA ---------- */}
      <section className="container mx-auto px-4 py-20">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-accent px-6 py-14 text-center text-white shadow-lg sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"
          />
          <div className="relative">
            <BookSparkMark className="mx-auto h-14 w-14" />
            <h2 className="mt-5 font-headline text-3xl font-bold sm:text-4xl">
              Make their first story today
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-white/90">
              It takes a couple of minutes to get started — and the smile when
              they see themselves on the page lasts a lot longer.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg" variant="secondary" className="w-full px-8 sm:w-auto">
                <Link href="/signup">Get started free</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="w-full border-white/60 bg-transparent px-8 text-white hover:bg-white/15 hover:text-white sm:w-auto"
              >
                <Link href="/login">I already have an account</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
