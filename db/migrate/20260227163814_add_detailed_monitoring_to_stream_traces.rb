class AddDetailedMonitoringToStreamTraces < ActiveRecord::Migration[7.2]
  def change
    add_column :stream_traces, :sdk_total_chunks, :integer
    add_column :stream_traces, :missing_sequences, :text
    add_column :stream_traces, :loss_position, :string
    add_column :stream_traces, :first_chunk_delay, :integer
    add_column :stream_traces, :avg_chunk_interval, :integer
    add_column :stream_traces, :last_chunk_delay, :integer

  end
end
