'use client'

/**
 * Lenses onto the single memory pool — views, not folders.
 * Shared by the desktop sidebar and the mobile lens chip row.
 */
import {
  AudioLines,
  CalendarClock,
  FileText,
  Image as ImageIcon,
  Inbox,
  Link2,
  ListTodo,
  StickyNote,
  Users,
} from 'lucide-react'
import type { Lens } from './store'

export const LENSES: Array<{ id: Lens; label: string; icon: React.ReactNode }> = [
  { id: 'all', label: 'Everything', icon: <Inbox className="h-4 w-4" /> },
  { id: 'deadlines', label: 'Deadlines', icon: <CalendarClock className="h-4 w-4" /> },
  { id: 'meetings', label: 'Meetings', icon: <Users className="h-4 w-4" /> },
  { id: 'link', label: 'Links', icon: <Link2 className="h-4 w-4" /> },
  { id: 'pdf', label: 'PDFs', icon: <FileText className="h-4 w-4" /> },
  { id: 'image', label: 'Screenshots', icon: <ImageIcon className="h-4 w-4" /> },
  { id: 'audio', label: 'Voice notes', icon: <AudioLines className="h-4 w-4" /> },
  { id: 'text', label: 'Text notes', icon: <StickyNote className="h-4 w-4" /> },
  { id: 'unprocessed', label: 'Processing', icon: <ListTodo className="h-4 w-4" /> },
]
