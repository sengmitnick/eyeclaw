class CreateStreamTraces < ActiveRecord::Migration[7.2]
  def change
    create_table :stream_traces do |t|
      t.string :trace_id
      t.string :message_id
      t.string :agent_id
      t.integer :bot_id
      t.string :status, default: "pending"
      t.text :events
      t.text :sdk_content
      t.text :sse_content
      t.integer :sdk_chunk_count, default: 0
      t.integer :sse_chunk_count, default: 0
      t.text :anomaly


      t.timestamps
    end
  end
end
