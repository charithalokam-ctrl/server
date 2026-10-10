import mongoose from 'mongoose';

const InterventionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, required: true },
    interventionType: { type: String, required: true },
    notes: { type: String },
    dispatchedBy: { type: String, default: 'Faculty Dean' },
    date: { type: String, default: () => new Date().toISOString() }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

export const Intervention = mongoose.model('Intervention', InterventionSchema);
export default Intervention;
