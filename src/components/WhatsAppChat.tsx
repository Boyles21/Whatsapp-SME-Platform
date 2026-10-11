import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  CheckCheck, 
  Phone, 
  Video, 
  MoreVertical, 
  Smile, 
  Paperclip, 
  Bot, 
  TrendingUp, 
  Package, 
  AlertTriangle, 
  CheckCircle2, 
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  ShoppingBag,
  LayoutDashboard
} from 'lucide-react';
import { ChatMessage, Product } from '../types.ts';

interface WhatsAppChatProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  isSending: boolean;
  currencySymbol: string;
  businessName: string;
  onSwitchToDashboard?: () => void;
}

export const WhatsAppChat: React.FC<WhatsAppChatProps> = ({
  messages,
  onSendMessage,
  isSending,
  currencySymbol,
  businessName,
  onSwitchToDashboard,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const handleSend = (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || isSending) return;
    onSendMessage(text);
    if (!textToSend) {
      setInputText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const samplePrompts = [
    { label: '📦 Restock Indomie', text: 'Add 50 cartons of Indomie at 7500 each' },
    { label: '💰 Record Sale', text: 'I sold 5 cartons of Indomie for 42500' },
    { label: '🔍 Check Stock', text: 'How much Indomie do I have?' },
    { label: '📊 Today\'s Sales', text: 'What did I sell today?' },
    { label: '⚠️ Low Stock', text: 'Which products are low?' },
    { label: '🛑 Test Negative Guard', text: 'I sold 100 cartons of Indomie for 850000' },
  ];

  return (
    <div id="whatsapp-container" className="flex flex-col h-full bg-[#efeae2] relative overflow-hidden border border-emerald-800/20 shadow-md">
      {/* WhatsApp Header */}
      <div className="bg-[#008069] text-white px-4 py-3 flex items-center justify-between shadow z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-emerald-900 border border-emerald-400 flex items-center justify-center text-white font-bold shadow-inner">
              <Bot className="w-6 h-6 text-emerald-300" />
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-[#008069] rounded-full"></span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="font-semibold text-sm sm:text-base leading-tight">SME Inventory Assistant</h2>
              <span className="bg-emerald-700/80 text-[10px] px-1.5 py-0.5 rounded text-emerald-100 font-medium">BOT</span>
            </div>
            <p className="text-xs text-emerald-100/90 leading-tight">
              online • {businessName || 'Store Assistant'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 text-emerald-100">
          {onSwitchToDashboard && (
            <button
              onClick={onSwitchToDashboard}
              className="md:hidden flex items-center gap-1 text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white px-2.5 py-1 rounded-lg transition-colors border border-emerald-500/40 shadow-xs"
              title="Open Live Inventory Dashboard"
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </button>
          )}
          <button title="Phone call" className="p-1.5 hover:bg-emerald-700 rounded-full transition-colors hidden sm:block">
            <Phone className="w-4 h-4" />
          </button>
          <button title="Video call" className="p-1.5 hover:bg-emerald-700 rounded-full transition-colors hidden sm:block">
            <Video className="w-4 h-4" />
          </button>
          <button title="Options" className="p-1.5 hover:bg-emerald-700 rounded-full transition-colors">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* WhatsApp Quick Prompts Bar */}
      <div className="bg-[#f0f2f5] border-b border-gray-200 px-3 py-2 z-10 flex items-center gap-2 overflow-x-auto scrollbar-none touch-pan-x">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap flex items-center gap-1 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> Quick:
        </span>
        <div className="flex gap-1.5 shrink-0">
          {samplePrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(p.text)}
              disabled={isSending}
              className="text-xs font-medium px-3 py-1.5 bg-white hover:bg-emerald-50 active:bg-emerald-100 text-gray-700 hover:text-emerald-800 border border-gray-200 hover:border-emerald-300 rounded-full transition-all whitespace-nowrap shadow-2xs disabled:opacity-50 min-h-[34px] flex items-center"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Messages Area */}
      <div 
        className="flex-1 overflow-y-auto p-2.5 sm:p-4 space-y-3 relative"
        style={{
          backgroundImage: `radial-gradient(#d1d7db 0.8px, transparent 0.8px)`,
          backgroundSize: '16px 16px',
        }}
      >
        {/* Encryption & Atomic Notice Banner */}
        <div className="flex justify-center my-2">
          <div className="bg-[#ffeecd] text-[#54656f] text-[11px] px-3 py-1.5 rounded-lg shadow-xs max-w-md text-center border border-[#e2d5bd] flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>Messages are processed via AI. Inventory updates are executed via <b>atomic backend functions</b> with audit records.</span>
          </div>
        </div>

        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          return (
            <div
              key={msg.id}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`relative max-w-[85%] sm:max-w-[75%] rounded-lg px-3 py-2 shadow-xs ${
                  isUser
                    ? 'bg-[#d9fdd3] text-gray-900 rounded-tr-none'
                    : 'bg-white text-gray-900 rounded-tl-none border border-gray-100'
                }`}
              >
                {/* Message Text with simple WhatsApp markup formatting */}
                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {renderFormattedText(msg.text)}
                </div>

                {/* Structured Interactive Attachment Cards */}
                {msg.structuredData && (
                  <div className="mt-2.5 pt-2 border-t border-gray-100">
                    {/* SALE RECEIPT CARD */}
                    {msg.structuredData.type === 'SALE_RECEIPT' && msg.structuredData.sale && (
                      <div className="bg-emerald-50/70 border border-emerald-200 rounded-md p-2.5 text-xs text-emerald-950">
                        <div className="flex items-center justify-between font-semibold pb-1.5 mb-1.5 border-b border-emerald-200/60">
                          <span className="flex items-center gap-1 text-emerald-800">
                            <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
                            Official Invoice
                          </span>
                          <span className="font-mono text-[10px] text-emerald-700">{msg.structuredData.sale.invoiceNumber}</span>
                        </div>
                        <div className="space-y-1">
                          {(msg.structuredData.sale.items || []).map((item, idx) => (
                            <div key={idx} className="flex justify-between">
                              <span>{item.quantity}x {item.productName || item.productNameSnapshot || 'Product'}</span>
                              <span className="font-semibold">{currencySymbol}{(item.subtotal || item.total || 0).toLocaleString()}</span>
                            </div>
                          ))}
                          <div className="flex justify-between pt-1 border-t border-emerald-200/50 font-bold text-emerald-900">
                            <span>Total Paid:</span>
                            <span>{currencySymbol}{(msg.structuredData.sale.totalAmount || msg.structuredData.sale.total || 0).toLocaleString()}</span>
                          </div>
                          {msg.structuredData.product && (
                            <div className="mt-1 pt-1 text-[11px] text-emerald-700 flex items-center justify-between">
                              <span>Remaining Stock:</span>
                              <span className="font-semibold">{msg.structuredData.product.currentStock} {msg.structuredData.product.unit}(s)</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* STOCK CONFIRMATION CARD */}
                    {msg.structuredData.type === 'STOCK_CONFIRMATION' && msg.structuredData.product && (
                      <div className="bg-blue-50/70 border border-blue-200 rounded-md p-2.5 text-xs text-blue-950">
                        <div className="flex items-center justify-between font-semibold pb-1.5 mb-1.5 border-b border-blue-200/60">
                          <span className="flex items-center gap-1 text-blue-800">
                            <Package className="w-3.5 h-3.5 text-blue-600" />
                            Stock In Confirmation
                          </span>
                          <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-mono">
                            {msg.structuredData.product.sku}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                          <div>
                            <span className="text-gray-500 block">Product:</span>
                            <span className="font-medium text-gray-900">{msg.structuredData.product.name}</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">New Balance:</span>
                            <span className="font-bold text-emerald-700">
                              {msg.structuredData.product.currentStock} {msg.structuredData.product.unit}(s)
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">Selling Price:</span>
                            <span className="font-medium">{currencySymbol}{msg.structuredData.product.sellingPrice.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">Min Threshold:</span>
                            <span className="font-medium">{msg.structuredData.product.minStockLevel}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* LOW STOCK ALERT CARD */}
                    {msg.structuredData.type === 'LOW_STOCK_ALERT' && msg.structuredData.products && (
                      <div className="bg-amber-50/80 border border-amber-200 rounded-md p-2 text-xs text-amber-950">
                        <div className="flex items-center gap-1 font-semibold text-amber-800 mb-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          <span>Reorder Recommendations</span>
                        </div>
                        <div className="space-y-1.5">
                          {msg.structuredData.products.map(p => (
                            <div key={p.id} className="flex items-center justify-between bg-white/80 p-1.5 rounded border border-amber-100">
                              <div>
                                <span className="font-medium text-gray-900 block">{p.name}</span>
                                <span className="text-[10px] text-red-600 font-semibold">
                                  {p.currentStock} left (Min: {p.minStockLevel})
                                </span>
                              </div>
                              <button
                                onClick={() => handleSend(`Add 20 cartons of ${p.name} at ${p.costPrice} each`)}
                                className="text-[11px] px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium transition-colors"
                              >
                                Restock +20
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* CLARIFICATION / SUGGESTED ACTIONS */}
                    {msg.structuredData.suggestedActions && msg.structuredData.suggestedActions.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block">Suggested replies:</span>
                        <div className="flex flex-wrap gap-1">
                          {msg.structuredData.suggestedActions.map((action, i) => (
                            <button
                              key={i}
                              onClick={() => handleSend(action)}
                              className="text-[11px] text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full transition-colors font-medium text-left"
                            >
                              👉 {action}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Timestamp & Double Checkmarks */}
                <div className="flex items-center justify-end gap-1 mt-1 -mb-0.5 text-[10px] text-gray-500">
                  <span>{time}</span>
                  {isUser && (
                    <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator when processing */}
        {isSending && (
          <div className="flex justify-start">
            <div className="bg-white text-gray-500 text-xs px-3 py-2 rounded-lg rounded-tl-none border border-gray-100 shadow-xs flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 bg-emerald-600 rounded-full animate-bounce"></span>
              <span className="inline-block w-1.5 h-1.5 bg-emerald-600 rounded-full animate-bounce [animation-delay:0.2s]"></span>
              <span className="inline-block w-1.5 h-1.5 bg-emerald-600 rounded-full animate-bounce [animation-delay:0.4s]"></span>
              <span className="ml-1 text-[11px] text-gray-600 font-medium">Validating & executing atomically...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* WhatsApp Input Bar */}
      <div className="bg-[#f0f2f5] px-2.5 sm:px-3 py-2 sm:py-2.5 pb-safe flex items-center gap-2 border-t border-gray-200 z-10 shrink-0">
        <button 
          title="Emoji" 
          className="text-gray-500 hover:text-gray-700 p-2 transition-colors hidden sm:block rounded-full hover:bg-gray-200/60"
        >
          <Smile className="w-5 h-5" />
        </button>
        <button 
          title="Attach" 
          className="text-gray-500 hover:text-gray-700 p-2 transition-colors hidden sm:block rounded-full hover:bg-gray-200/60"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        <div className="flex-1 relative">
          <input
            id="whatsapp-chat-input"
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command (e.g. 'Sell 5 Indomie')..."
            disabled={isSending}
            className="w-full bg-white border border-gray-200 rounded-full px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#008069] focus:border-[#008069] shadow-2xs"
          />
        </div>

        <button
          id="whatsapp-send-button"
          onClick={() => handleSend()}
          disabled={!inputText.trim() || isSending}
          className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full text-white transition-all shadow-sm flex items-center justify-center shrink-0 ${
            inputText.trim() && !isSending
              ? 'bg-[#008069] hover:bg-[#00705b] active:scale-95'
              : 'bg-gray-300 cursor-not-allowed opacity-60'
          }`}
          title="Send message"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

// Helper function to format WhatsApp bold (*text*), italics (_text_), and code (`code`)
function renderFormattedText(text: string): React.ReactNode {
  // Simple token parser for WhatsApp markdown: *bold*, _italics_, `code`
  const parts: React.ReactNode[] = [];
  const lines = text.split('\n');

  lines.forEach((line, lineIdx) => {
    // Process bold *words*
    const boldRegex = /\*(.*?)\*/g;
    let match;
    let lastIndex = 0;
    const lineElements: React.ReactNode[] = [];

    while ((match = boldRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        lineElements.push(line.substring(lastIndex, match.index));
      }
      lineElements.push(
        <strong key={`b-${match.index}`} className="font-semibold text-gray-950">
          {match[1]}
        </strong>
      );
      lastIndex = boldRegex.lastIndex;
    }
    if (lastIndex < line.length) {
      lineElements.push(line.substring(lastIndex));
    }

    parts.push(
      <span key={`line-${lineIdx}`}>
        {lineElements.length > 0 ? lineElements : line}
        {lineIdx < lines.length - 1 && <br />}
      </span>
    );
  });

  return <>{parts}</>;
}
