class AddRokidUserIdToBots < ActiveRecord::Migration[7.2]
  def change
    add_column :bots, :rokid_user_id, :string
    add_index :bots, :rokid_user_id
  end
end
