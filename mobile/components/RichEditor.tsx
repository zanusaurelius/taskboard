import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

// Dark-themed contenteditable editor that produces TipTap-compatible HTML.
// Uses document.execCommand (supported in all mobile WebViews) so text is
// visually formatted (bold renders as bold, bullets as bullets, etc.).

const EDITOR_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #1e293b; }
  body { padding: 0 20px 60px; }
  #editor {
    outline: none;
    min-height: 300px;
    color: #cbd5e1;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 16px;
    line-height: 1.625;
    word-break: break-word;
    caret-color: #6366f1;
  }
  #editor:empty::before {
    content: attr(data-placeholder);
    color: #334155;
    pointer-events: none;
  }
  b, strong { font-weight: 700; color: #e2e8f0; }
  i, em { font-style: italic; }
  u { text-decoration: underline; }
  code {
    font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
    font-size: 14px;
    background: #1e293b;
    color: #7dd3fc;
    border-radius: 4px;
    padding: 1px 6px;
  }
  pre {
    background: #1e293b;
    border-radius: 8px;
    padding: 12px 16px;
    margin: 8px 0;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; border-radius: 0; }
  ul, ol { padding-left: 22px; margin: 6px 0; }
  li { margin: 3px 0; }
  ul li { list-style-type: disc; }
  ol li { list-style-type: decimal; }
  p { margin: 2px 0; }
  h1 { font-size: 22px; font-weight: 800; color: #f1f5f9; margin: 8px 0 4px; }
  h2 { font-size: 18px; font-weight: 700; color: #e2e8f0; margin: 6px 0 4px; }
  h3 { font-size: 16px; font-weight: 700; color: #e2e8f0; margin: 4px 0 2px; }
  blockquote {
    border-left: 3px solid #6366f1;
    margin: 8px 0;
    padding-left: 14px;
    color: #94a3b8;
  }
  img { max-width: 100%; border-radius: 8px; margin: 8px 0; }
  a { color: #818cf8; }
</style>
</head>
<body>
<div id="editor" contenteditable="true" data-placeholder="Start writing…"></div>
<script>
  const editor = document.getElementById('editor');
  let ignoreNextInput = false;

  // Receive messages from React Native
  window.addEventListener('message', function(e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.type === 'setContent') {
        editor.innerHTML = msg.html || '';
        sendHeight();
        // Place cursor at end after setting content
        var range = document.createRange();
        var sel = window.getSelection();
        range.selectNodeContents(editor);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } else if (msg.type === 'execCommand') {
        editor.focus();
        document.execCommand(msg.command, false, msg.value || null);
        sendContent();
      } else if (msg.type === 'focus') {
        editor.focus();
      } else if (msg.type === 'insertImage') {
        document.execCommand('insertImage', false, msg.url);
        sendContent();
      }
    } catch(err) {}
  });

  function sendContent() {
    var html = editor.innerHTML;
    // Normalise empty editor
    if (html === '<br>' || html === '') html = '';
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'content', html: html }));
  }

  function sendHeight() {
    var h = editor.scrollHeight + 60;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', height: h }));
  }

  editor.addEventListener('input', function() {
    sendContent();
    sendHeight();
  });

  editor.addEventListener('focus', function() {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'focus' }));
  });

  editor.addEventListener('blur', function() {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'blur' }));
  });

  // Fix: pressing Enter in a list creates proper li, not div
  editor.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Default behaviour is fine for lists; override for plain paragraphs
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var node = sel.getRangeAt(0).startContainer;
      var block = node.nodeType === 3 ? node.parentElement : node;
      if (block && (block.tagName === 'LI' || block.closest && block.closest('li'))) return;
      // Insert a p-wrapped newline for non-list context
      e.preventDefault();
      document.execCommand('insertParagraph', false, null);
    }
  });

  // Send initial height
  window.addEventListener('load', sendHeight);
</script>
</body>
</html>`;

export interface RichEditorRef {
  bold: () => void;
  italic: () => void;
  underline: () => void;
  bulletList: () => void;
  orderedList: () => void;
  code: () => void;
  insertImage: (url: string) => void;
  focus: () => void;
  setContent: (html: string) => void;
}

interface Props {
  initialContent?: string;
  onChange: (html: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
  onHeightChange?: (height: number) => void;
}

const RichEditor = forwardRef<RichEditorRef, Props>(
  ({ initialContent, onChange, onFocus, onBlur, style, onHeightChange }, ref) => {
    const webRef = useRef<WebView>(null);

    const post = useCallback((msg: object) => {
      const json = JSON.stringify(msg);
      webRef.current?.injectJavaScript(
        `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(json)}}));true;`
      );
    }, []);

    useImperativeHandle(ref, () => ({
      bold:        () => post({ type: 'execCommand', command: 'bold' }),
      italic:      () => post({ type: 'execCommand', command: 'italic' }),
      underline:   () => post({ type: 'execCommand', command: 'underline' }),
      bulletList:  () => post({ type: 'execCommand', command: 'insertUnorderedList' }),
      orderedList: () => post({ type: 'execCommand', command: 'insertOrderedList' }),
      code:        () => post({ type: 'execCommand', command: 'formatBlock', value: 'pre' }),
      insertImage: (url) => post({ type: 'insertImage', url }),
      focus:       () => post({ type: 'focus' }),
      setContent:  (html) => post({ type: 'setContent', html }),
    }));

    const onMessage = useCallback((event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'content') onChange(msg.html);
        else if (msg.type === 'focus') onFocus?.();
        else if (msg.type === 'blur') onBlur?.();
        else if (msg.type === 'height') onHeightChange?.(msg.height);
      } catch {}
    }, [onChange, onFocus, onBlur, onHeightChange]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AnyWebView = WebView as any;
    return (
      <AnyWebView
        ref={webRef}
        source={{ html: EDITOR_HTML }}
        onMessage={onMessage}
        onLoadEnd={() => {
          if (initialContent) post({ type: 'setContent', html: initialContent });
        }}
        scrollEnabled={false}
        style={style}
        backgroundColor="#1e293b"
        keyboardDisplayRequiresUserAction={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        overScrollMode="never"
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
      />
    );
  }
);

export default RichEditor;
