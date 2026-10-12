import { UploadForm } from './upload-form';

export default function ImportsPage() {
  return (
    <>
      <div>
        <div className="note" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>Imports & Data Quality</div>
        <h1>Import Zomato data</h1>
      </div>
      <UploadForm />
    </>
  );
}
