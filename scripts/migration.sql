-- Create a table for chat history
create table if not exists chat_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  session_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table chat_history enable row level security;

-- Create a policy that allows users to see only their own chats
create policy "Users can view their own chat history"
  on chat_history for select
  using (auth.uid() = user_id);

-- Create a policy that allows users to insert their own chats
create policy "Users can insert their own chat history"
  on chat_history for insert
  with check (auth.uid() = user_id);
