"use client";

import { useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { Button } from "@/components/ds/button";
import type { LessonVideo as Video } from "@/lib/tutor";

function minutes(s: number): string {
  const m = Math.max(1, Math.round(s / 60));
  return m === 1 ? "دقيقة" : m === 2 ? "دقيقتان" : `${m} دقائق`;
}

/**
 * A YouTube video that explains the lesson's topic, chosen by the tutor.
 * Nothing loads from YouTube until the student presses play (only the
 * thumbnail); the player is the privacy-enhanced youtube-nocookie.com one.
 * It is labelled as coming from YouTube, not from the student's file.
 */
export function LessonVideo({ video }: { video: Video }) {
  const [playing, setPlaying] = useState(false);
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
  return (
    <figure className="mt-4">
      <div className="relative aspect-video overflow-hidden rounded-control border border-line bg-canvas">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=1&rel=0`}
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full"
          />
        ) : (
          <Button variant="bare" onClick={() => setPlaying(true)} aria-label={`شغّل الفيديو: ${video.title}`} className="group absolute inset-0 size-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- a remote YouTube thumbnail; the site is a static export */}
            <img
              src={`https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => (e.currentTarget.style.display = "none")}
              className="absolute inset-0 size-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30">
              <span className="flex size-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-card">
                <Play className="size-6" aria-hidden />
              </span>
            </span>
          </Button>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-small text-ink-muted">
        <span className="font-bold text-ink">فيديو يشرح الموضوع</span>
        <span dir="auto">{video.title}</span>
        <span>· {video.channel} · {minutes(video.seconds)}</span>
        <span className="text-caption">من يوتيوب — ليس من ملفك</span>
        <a href={watch} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-caption underline-offset-2 hover:underline">
          افتحه في يوتيوب <ExternalLink className="size-3" aria-hidden />
        </a>
      </figcaption>
    </figure>
  );
}
