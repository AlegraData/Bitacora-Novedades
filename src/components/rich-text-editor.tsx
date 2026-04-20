'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, Quote, Link as LinkIcon, Code, SquareCode
} from 'lucide-react'
import { useEffect, useState } from 'react'

interface RichTextEditorProps {
  content: string
  onChange: (html: string) => void
  editable?: boolean
  placeholder?: string
  autoFocus?: boolean
  onBlur?: () => void
}

export function RichTextEditor({
  content,
  onChange,
  editable = true,
  placeholder = 'Escribe algo...',
  autoFocus = false,
  onBlur
}: RichTextEditorProps) {
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false, // We use "Título" blocks instead
        codeBlock: { HTMLAttributes: { class: 'tiptap-code-block' } },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'tiptap-link', target: '_blank', rel: 'noopener noreferrer' },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: content || '',
    editable,
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    onBlur: () => {
      if (onBlur) onBlur()
    },
    editorProps: {
      attributes: {
        class: 'tiptap-editor-container',
      },
    },
  })

  // Sync external content changes if editor is not focused
  useEffect(() => {
    if (editor && !editor.isFocused && content !== editor.getHTML()) {
      editor.commands.setContent(content || '', { emitUpdate: false })
    }
  }, [content, editor])

  // Sync editable state dynamically
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable)
      if (editable) {
        // Use a small timeout to allow layout to happen before focusing
        setTimeout(() => {
          if (!editor.isFocused) {
            editor.commands.focus()
          }
        }, 10)
      }
    }
  }, [editable, editor])

  if (!editor) return null

  const openLinkModal = () => {
    setLinkUrl(editor.getAttributes('link').href || '')
    setIsLinkModalOpen(true)
  }

  const saveLink = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (linkUrl === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      let finalUrl = linkUrl
      if (!/^https?:\/\//i.test(finalUrl)) {
        finalUrl = 'https://' + finalUrl
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: finalUrl }).run()
    }
    setIsLinkModalOpen(false)
  }

  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    setIsLinkModalOpen(false)
  }

  const showToolbar = editable && editor && (editor.isFocused || isLinkModalOpen)

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {showToolbar && (
        <div className="tiptap-floating-toolbar" onMouseDown={(e) => e.preventDefault()}>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'is-active' : ''}
            title="Negrita"
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive('italic') ? 'is-active' : ''}
            title="Cursiva"
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={editor.isActive('underline') ? 'is-active' : ''}
            title="Subrayado"
          >
            <UnderlineIcon size={14} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={editor.isActive('strike') ? 'is-active' : ''}
            title="Tachado"
          >
            <Strikethrough size={14} />
          </button>

          <div className="divider" />

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive('bulletList') ? 'is-active' : ''}
            title="Lista viñetas"
          >
            <List size={14} />
          </button>

          <div className="divider" />

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={editor.isActive('blockquote') ? 'is-active' : ''}
            title="Cita"
          >
            <Quote size={14} />
          </button>
          <button
            type="button"
            onClick={openLinkModal}
            className={editor.isActive('link') ? 'is-active' : ''}
            title="Enlace"
          >
            <LinkIcon size={14} />
          </button>

          <div className="divider" />

          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={editor.isActive('code') ? 'is-active' : ''}
            title="Código en línea"
          >
            <Code size={14} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={editor.isActive('codeBlock') ? 'is-active' : ''}
            title="Bloque de código"
          >
            <SquareCode size={14} />
          </button>
        </div>
      )}

      <EditorContent editor={editor} />

      <Dialog.Root open={isLinkModalOpen} onOpenChange={setIsLinkModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(15,23,42,0.3)', backdropFilter: 'blur(2px)',
            animation: 'fadeIn 0.2s ease'
          }} />
          <Dialog.Content 
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              editor.commands.focus()
            }}
            style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              zIndex: 10000, background: '#fff', borderRadius: 12, padding: '24px',
              width: '90%', maxWidth: 400, boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
              animation: 'slideUp 0.2s ease', border: '1px solid #e2e8f0'
            }}
          >
            <Dialog.Title style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
              {editor.isActive('link') ? 'Editar enlace' : 'Añadir enlace'}
            </Dialog.Title>
            <form onSubmit={saveLink}>
              <input
                type="url"
                autoFocus
                placeholder="https://ejemplo.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 8,
                  border: '1px solid #cbd5e1', fontSize: 14, outline: 'none',
                  marginBottom: 20, color: '#1e293b', transition: 'border-color 0.2s'
                }}
                onFocus={(e) => { e.target.style.borderColor = '#00C4A0' }}
                onBlur={(e) => { e.target.style.borderColor = '#cbd5e1' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                {editor.isActive('link') && (
                  <button
                    type="button"
                    onClick={removeLink}
                    style={{
                      padding: '8px 16px', background: '#fff5f5', color: '#ef4444',
                      border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#fee2e2' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#fff5f5' }}
                  >
                    Quitar enlace
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsLinkModalOpen(false)}
                  style={{
                    padding: '8px 16px', background: '#f8fafc', color: '#475569',
                    border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 20px', background: '#00C4A0', color: '#fff',
                    border: 'none', borderRadius: 8, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#00A888' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#00C4A0' }}
                >
                  Guardar
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
