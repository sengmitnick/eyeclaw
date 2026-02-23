class CreateBotSessions < ActiveRecord::Migration[7.2]
  def change
    create_table :bot_sessions do |t|
      t.references :bot
      t.string :session_id
      t.datetime :connected_at
      t.datetime :last_ping_at
      t.jsonb :metadata, default: {}

      t.index :session_id, unique: true

      t.timestamps
    end
  end
end
